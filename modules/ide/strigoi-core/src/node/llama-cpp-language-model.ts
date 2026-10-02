import {
    createToolCallError,
    formatToolCallContentForModel,
    hasToolCallError,
    LanguageModel,
    LanguageModelMessage,
    LanguageModelResponse,
    LanguageModelStatus,
    LanguageModelStreamResponsePart,
    ToolCall,
    ToolCallResult,
    ToolRequest,
    UserRequest
} from '@theia/ai-core';
import { CancellationToken } from '@theia/core';
import { LocalRuntimeConfiguration } from '../common/local-runtime-service';
import { LlamaCppRuntimeProvider } from './llama-cpp-runtime-provider';

interface OpenAiToolCall {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
}

interface OpenAiStreamChunk {
    choices?: Array<{
        delta?: {
            content?: string;
            reasoning_content?: string;
            tool_calls?: OpenAiToolCall[];
        };
        finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string; type?: string };
}

interface CompletionMetadata {
    finishReason?: string;
    sawDone: boolean;
    toolCalls: ToolCall[];
    content: string;
}

type OpenAiMessage = Record<string, unknown>;

/** Stable JSON keeps equivalent argument objects from bypassing the loop breaker by key order. */
export function canonicalizeToolArguments(argumentsText: string): string {
    try {
        return JSON.stringify(sortJsonValue(JSON.parse(argumentsText)));
    } catch {
        return argumentsText.trim();
    }
}

function sortJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortJsonValue);
    }
    if (value && typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
            result[key] = sortJsonValue((value as Record<string, unknown>)[key]);
            return result;
        }, {});
    }
    return value;
}

export function toolCallFingerprint(name: string | undefined, argumentsText: string): string {
    return `${name ?? 'unknown'}\n${canonicalizeToolArguments(argumentsText)}`;
}

function toolFailureMessage(result: ToolCallResult): string | undefined {
    if (hasToolCallError(result)) {
        return formatToolCallContentForModel(result);
    }
    const candidate = typeof result === 'string'
        ? tryParseJson(result)
        : result;
    if (candidate && typeof candidate === 'object' && typeof (candidate as { error?: unknown }).error === 'string') {
        return (candidate as { error: string }).error;
    }
    return undefined;
}

function tryParseJson(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}

/**
 * The local llama.cpp server does not run client tools itself. This bridge owns
 * the bounded model -> tool -> model loop required by the compatible API.
 */
export class LlamaCppLanguageModel implements LanguageModel {

    readonly providerId = 'llama.cpp';
    readonly vendor = 'llama.cpp';

    // Qwen3's packaged models support 32k tokens.  16k is a practical local
    // default: substantially more room for research/tool results than 8k,
    // without the first-token and KV-cache cost of always reserving 32k.
    protected static readonly CONTEXT_WINDOW_TOKENS = 16384;
    protected static readonly MIN_RESPONSE_RESERVE_TOKENS = 1536;
    /** Enough for genuine coding workflows while retaining a finite circuit breaker. */
    protected static readonly MAX_TOOL_ROUNDS = 16;

    constructor(
        readonly id: string,
        protected readonly model: string,
        public status: LanguageModelStatus,
        protected readonly configurationProvider: () => LocalRuntimeConfiguration,
        protected readonly runtime: LlamaCppRuntimeProvider
    ) { }

    async request(request: UserRequest, cancellationToken?: CancellationToken): Promise<LanguageModelResponse> {
        const configuration = this.configurationProvider();
        const runtimeStatus = await this.runtime.loadModel(configuration);
        if (!runtimeStatus.endpoint) {
            throw new Error('O runtime llama.cpp não informou um endpoint local.');
        }

        const controller = new AbortController();
        const cancellation = cancellationToken?.onCancellationRequested(() => controller.abort());
        const streaming = request.settings?.stream !== false || !!request.tools?.length;
        const messages = this.fitMessagesInContext(
            request.messages.flatMap(message => {
                const converted = this.toOpenAiMessage(message);
                return converted ? [converted] : [];
            }),
            request
        );

        if (streaming) {
            return { stream: this.runStreamingRequest(runtimeStatus.endpoint, messages, request, controller, cancellation) };
        }

        try {
            const response = await this.postCompletion(runtimeStatus.endpoint, messages, request, false, controller.signal);
            const payload = await response.json() as {
                choices?: Array<{ message?: { content?: string } }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            return {
                text: payload.choices?.[0]?.message?.content ?? '',
                usage: payload.usage?.prompt_tokens === undefined || payload.usage.completion_tokens === undefined
                    ? undefined
                    : { input_tokens: payload.usage.prompt_tokens, output_tokens: payload.usage.completion_tokens }
            };
        } catch (error) {
            throw this.mapRequestError(error, controller.signal.aborted);
        } finally {
            cancellation?.dispose();
        }
    }

    protected async *runStreamingRequest(
        endpoint: string,
        initialMessages: OpenAiMessage[],
        request: UserRequest,
        controller: AbortController,
        cancellation: { dispose(): void } | undefined
    ): AsyncGenerator<LanguageModelStreamResponsePart> {
        let messages = initialMessages;
        let toolsEnabled = true;
        let continuationCount = 0;
        let activeRequest = request;
        const planning = request.settings?.strigoi_plan_mode === true;
        let completedToolRounds = 0;
        const previousFailures = new Map<string, string>();
        const completedResults = new Map<string, ToolCallResult>();
        try {
            for (let round = 0; ; round++) {
                const response = await this.postCompletion(endpoint, messages, activeRequest, true, controller.signal, toolsEnabled);
                if (!response.body) {
                    throw new Error('O runtime llama.cpp não retornou um stream de resposta.');
                }

                const stream = this.parseStream(response.body);
                let metadata: CompletionMetadata | undefined;
                while (true) {
                    const next = await stream.next();
                    if (next.done) {
                        metadata = next.value;
                        break;
                    }
                    yield next.value;
                }

                if (!metadata?.sawDone) {
                    throw new Error('O runtime llama.cpp encerrou o stream sem o evento final [DONE]. A resposta foi mantida como interrompida.');
                }
                if (metadata.finishReason === 'length') {
                    // An unfinished function call is not safe to replay or execute.
                    if (metadata.toolCalls.length) {
                        throw new Error('A geração cortou uma chamada de ferramenta incompleta. Nenhuma chamada desta rodada foi executada; o texto foi preservado.');
                    }
                    if (continuationCount >= 3) {
                        throw new Error('A resposta atingiu o limite após 3 continuações automáticas. O texto foi preservado; divida a tarefa em etapas menores.');
                    }
                    if (controller.signal.aborted || request.cancellationToken?.isCancellationRequested) {
                        throw new Error('A geração local foi cancelada.');
                    }
                    continuationCount++;
                    // Never replay private reasoning. Recovery uses low effort so
                    // another full Thinking budget cannot starve the visible answer.
                    activeRequest = { ...request, reasoning: { level: 'minimal' } };
                    const continuation = [
                        ...messages,
                        ...(metadata.content ? [{ role: 'assistant', content: metadata.content }] : []),
                        { role: 'user', content: metadata.content
                            ? 'Continue the interrupted response exactly from the last visible word, without repeating text. Finish the requested deliverable and its checkpoint concisely. Do not repeat completed tool operations.'
                            : 'The previous generation exhausted its reasoning budget without a visible answer. Use the supplied sources and completed tool results; answer the original request concisely now. Do not repeat completed tool operations.' }
                    ];
                    // Do not silently evict the original task/document to make
                    // a "continue" fit. Context exhaustion needs a different fix.
                    messages = continuation;
                    continue;
                }
                if (metadata.finishReason && !['stop', 'tool_calls'].includes(metadata.finishReason)) {
                    throw new Error(`O runtime llama.cpp interrompeu a geração (${metadata.finishReason}).`);
                }
                if (metadata.toolCalls.length === 0) {
                    return;
                }

                const finalTextAttemptFailed = !toolsEnabled;
                const completedCalls: Array<{ call: ToolCall; result: ToolCallResult }> = [];
                for (const call of metadata.toolCalls) {
                    const name = call.function?.name;
                    const tool = request.tools?.find(candidate => candidate.id === name || candidate.name === name);
                    const callId = call.id ?? `${request.requestId}-tool-${completedCalls.length}`;
                    const normalizedCall: ToolCall = { ...call, id: callId };
                    const argumentsText = normalizedCall.function?.arguments || '{}';
                    const fingerprint = toolCallFingerprint(name, argumentsText);
                    let result: ToolCallResult;
                    if (!toolsEnabled || round >= LlamaCppLanguageModel.MAX_TOOL_ROUNDS) {
                        result = createToolCallError(
                            `Tool budget exhausted after ${LlamaCppLanguageModel.MAX_TOOL_ROUNDS} rounds. Do not call additional tools. Produce the best final response possible using the information already gathered.`
                        );
                    } else if (!tool) {
                        result = createToolCallError(`A ferramenta '${name ?? 'desconhecida'}' não está disponível nesta solicitação.`, 'tool-not-available');
                    } else if (continuationCount > 0 && completedResults.has(fingerprint)) {
                        // A recovery must not replay already completed edits or
                        // other side effects merely because the model repeats a call.
                        result = completedResults.get(fingerprint)!;
                    } else if (previousFailures.has(fingerprint)) {
                        result = createToolCallError(
                            `Repeated tool call blocked: the same tool and arguments already returned "${previousFailures.get(fingerprint)}". Choose another path/tool or reason from the available information.`
                        );
                    } else {
                        try {
                            result = await tool.handler(
                                argumentsText,
                                { toolCallId: callId, cancellationToken: request.cancellationToken }
                            );
                        } catch (error) {
                            result = createToolCallError(error instanceof Error ? error.message : String(error));
                        }
                    }
                    const failure = toolFailureMessage(result);
                    if (failure && !previousFailures.has(fingerprint)) {
                        previousFailures.set(fingerprint, failure);
                    } else if (!failure) {
                        completedResults.set(fingerprint, result);
                    }
                    completedCalls.push({ call: normalizedCall, result });
                    yield { tool_calls: [{ ...normalizedCall, result, finished: true }] };
                }

                // Initial history was fitted once. Do not evict the source
                // turn after an automatic continuation introduces a new user
                // message; exact token budgeting below protects this window.
                messages = [
                    ...messages,
                    {
                        role: 'assistant',
                        content: '',
                        tool_calls: completedCalls.map(({ call }) => ({
                            id: call.id,
                            type: 'function',
                            function: { name: call.function?.name, arguments: call.function?.arguments || '{}' }
                        }))
                    },
                    ...completedCalls.map(({ call, result }) => ({
                        role: 'tool',
                        tool_call_id: call.id,
                        content: this.toolResultForContext(result, messages, call.function?.name)
                    }))
                ];
                completedToolRounds++;
                if (planning && completedToolRounds >= 4) {
                    toolsEnabled = false;
                    activeRequest = { ...request, reasoning: { level: 'minimal' } };
                    messages.push({ role: 'user', content: 'Read-only planning discovery is complete for this round. Now produce the concise plan for the selected skill artifact (not implementation of the feature described in its sources), plus the checkpoint. Do not schedule loading skills, reading/reviewing the supplied document, finding sources or making a plan: these are preparation already performed. Name concrete artifact sections and outcomes based on specific functional requirements. Use 3–8 numbered items, no tables. Only the supplied document and actual read results are content evidence. Directory listings prove filenames only, not metadata definitions or org state. Mark uninspected code, unknown paths and design choices as pending/proposed. No further tool calls.' });
                }
                // The next completion sees the structured budget result but receives no tool schema,
                // so it can finish the answer rather than making the whole request fail.
                if (round >= LlamaCppLanguageModel.MAX_TOOL_ROUNDS) {
                    toolsEnabled = false;
                }
                // A model that ignores the no-tools final request must not keep the bridge alive
                // forever. Its completed tool error remains visible and the chat stays usable.
                if (finalTextAttemptFailed) {
                    return;
                }
            }
        } catch (error) {
            throw this.mapRequestError(error, controller.signal.aborted);
        } finally {
            cancellation?.dispose();
        }
    }

    protected toolResultForContext(result: ToolCallResult, messages: OpenAiMessage[], toolName?: string): string {
        const text = formatToolCallContentForModel(result);
        // The attachment and getFileContent can supply the exact same large
        // document. Keep the complete UI result, but only one model-side copy.
        if (!hasToolCallError(result) && text.length > 1024
            && messages.some(message => typeof message.content === 'string' && message.content.includes(text))
        ) {
            return 'This exact tool result is already included in the earlier source context. Use that full content; do not read or append it again.';
        }
        if (toolName === 'getFileContent' && text.length > 6000) {
            // Primary attachments/selected skills were supplied in full before
            // inference. A large auxiliary read must be paged, not appended
            // wholesale (e.g. an 80k existing HTML can exhaust the window).
            return JSON.stringify({ preview: text.slice(0, 1600), omittedCharacters: text.length - 1600,
                note: 'Auxiliary file read exceeds this context budget. This is only a preview, not the full file. Use getFileContent with offset/limit for the specific relevant section. Do not claim unshown content was inspected. The complete tool result remains visible in the UI.' });
        }
        if (toolName === 'getWorkspaceFileList' && text.length > 2400) {
            // Listing breadth must not consume the space reserved for the
            // document and answer. Preserve complete JSON entries and label
            // the omitted entries; full results remain available in the UI.
            try {
                const listing = JSON.parse(text);
                const entries = Array.isArray(listing) ? listing.map((value, index) => [String(index), value]) : Object.entries(listing);
                const retained: Array<[string, unknown]> = [];
                for (const entry of entries) {
                    if (JSON.stringify([...retained, entry]).length > 2000) { break; }
                    retained.push(entry as [string, unknown]);
                }
                return JSON.stringify({ entries: Array.isArray(listing) ? retained.map(entry => entry[1]) : Object.fromEntries(retained),
                    omittedEntries: entries.length - retained.length,
                    note: 'Partial directory listing for context budget. Use targeted find/search for relevant filenames; do not assume omitted files are absent.' });
            } catch { return text; }
        }
        return text;
    }

    protected async postCompletion(
        endpoint: string,
        messages: OpenAiMessage[],
        request: UserRequest,
        stream: boolean,
        signal: AbortSignal,
        toolsEnabled = true
    ): Promise<Response> {
        const body = this.createCompletionBody(messages, request, stream, toolsEnabled);
        const promptTokens = await this.countCompletionTokens(endpoint, body, signal);
        const availableOutput = LlamaCppLanguageModel.CONTEXT_WINDOW_TOKENS - promptTokens - 256;
        if (availableOutput < 256) {
            throw new Error('Não há espaço de contexto para continuar preservando as fontes. O texto foi mantido; reduza os documentos/histórico ou divida a tarefa.');
        }
        body.max_tokens = Math.min(this.getMaxOutputTokens(request), availableOutput);
        const response = await fetch(`${endpoint}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const details = await response.text();
            const suffix = details.trim() ? `\n${details.trim()}` : ' (o runtime não retornou detalhes adicionais)';
            throw new Error(`O runtime llama.cpp respondeu HTTP ${response.status}.${suffix}`);
        }
        return response;
    }

    /** Count the actual model template, including function schemas, not characters/3.5. */
    protected async countCompletionTokens(endpoint: string, body: Record<string, unknown>, signal: AbortSignal): Promise<number> {
        const post = async (route: string, payload: unknown): Promise<Record<string, unknown>> => {
            const response = await fetch(`${endpoint}/${route}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error(`O runtime llama.cpp respondeu HTTP ${response.status} em ${route}.\n${await response.text()}`);
            }
            return response.json();
        };
        const rendered = await post('apply-template', body);
        if (typeof rendered.prompt !== 'string') { throw new Error('O runtime não retornou o chat template renderizado.'); }
        const tokenized = await post('tokenize', { content: rendered.prompt, add_special: false, parse_special: true });
        if (!Array.isArray(tokenized.tokens)) { throw new Error('O runtime não retornou a contagem real de tokens.'); }
        return tokenized.tokens.length;
    }

    protected createCompletionBody(messages: OpenAiMessage[], request: UserRequest, stream: boolean, toolsEnabled = true): Record<string, unknown> {
        const body: Record<string, unknown> = {
            model: this.model,
            messages,
            stream,
            max_tokens: this.getMaxOutputTokens(request),
            response_format: this.toResponseFormat(request)
        };
        if (stream) {
            body.stream_options = { include_usage: true };
        }
        if (toolsEnabled && request.tools?.length) {
            body.tools = request.tools.map(tool => this.toOpenAiTool(tool));
            body.tool_choice = 'auto';
            body.parse_tool_calls = true;
        }

        const reasoning = request.reasoning?.level;
        if (reasoning === 'off') {
            // GPT-OSS ignores enable_thinking; it still needs a supported
            // effort value instead of silently falling back to medium.
            body.chat_template_kwargs = { enable_thinking: false, reasoning_effort: 'low' };
        } else if (reasoning) {
            // The bundled llama.cpp accepts template kwargs on its OpenAI
            // endpoint.  Its older builds silently ignore a top-level
            // reasoning_effort field, so pass the value where Qwen's template
            // actually reads it.
            body.chat_template_kwargs = {
                enable_thinking: true,
                reasoning_effort: this.toLlamaReasoningEffort(reasoning)
            };
        }
        return body;
    }

    protected getMaxOutputTokens(request: UserRequest): number {
        const requested = request.settings?.max_tokens;
        if (typeof requested === 'number' && Number.isFinite(requested)) {
            return Math.max(256, Math.min(Math.floor(requested), 4096));
        }
        switch (request.reasoning?.level) {
            case 'off': return 2048;
            case 'minimal': return 2048;
            case 'low': return 2560;
            case 'medium': return 3072;
            case 'high': return 4096;
            default: return 3072;
        }
    }

    protected toLlamaReasoningEffort(level: NonNullable<UserRequest['reasoning']>['level']): 'low' | 'medium' | 'high' {
        if (level === 'minimal' || level === 'low') {
            return 'low';
        }
        if (level === 'medium' || level === 'auto') {
            return 'medium';
        }
        return 'high';
    }

    protected fitMessagesInContext(messages: OpenAiMessage[], request: UserRequest): OpenAiMessage[] {
        const budget = Math.max(
            LlamaCppLanguageModel.MIN_RESPONSE_RESERVE_TOKENS,
            LlamaCppLanguageModel.CONTEXT_WINDOW_TOKENS - this.getMaxOutputTokens(request) - 256
        );
        if (this.estimateTokens(messages) <= budget) {
            return messages;
        }
        const systemMessages = messages.filter(message => message.role === 'system');
        const turns: OpenAiMessage[][] = [];
        let current: OpenAiMessage[] = [];
        for (const message of messages.filter(message => message.role !== 'system')) {
            if (message.role === 'user' && current.length > 0) {
                turns.push(current);
                current = [];
            }
            current.push(message);
        }
        if (current.length > 0) {
            turns.push(current);
        }
        const retained = [...turns];
        while (retained.length > 1 && this.estimateTokens([...systemMessages, ...retained.flat()]) > budget) {
            retained.shift();
        }
        return [...systemMessages, ...retained.flat()];
    }

    protected estimateTokens(messages: OpenAiMessage[]): number {
        return Math.ceil(JSON.stringify(messages).length / 3.5);
    }

    protected async *parseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<LanguageModelStreamResponsePart, CompletionMetadata> {
        const decoder = new TextDecoder();
        const reader = body.getReader();
        const toolCalls = new Map<number, ToolCall>();
        let buffer = '';
        let finishReason: string | undefined;
        let sawDone = false;
        let content = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                const events = buffer.split('\n\n');
                buffer = events.pop() ?? '';
                for (const event of events) {
                    const data = event.split('\n').find(line => line.startsWith('data: '))?.slice(6);
                    if (!data) {
                        continue;
                    }
                    if (data === '[DONE]') {
                        sawDone = true;
                        continue;
                    }
                    const payload = JSON.parse(data) as OpenAiStreamChunk;
                    if (payload.error?.message) {
                        throw new Error(`O runtime llama.cpp retornou um erro no stream: ${payload.error.message}`);
                    }
                    const choice = payload.choices?.[0];
                    if (choice?.finish_reason) {
                        finishReason = choice.finish_reason;
                    }
                    const delta = choice?.delta;
                    if (delta?.content) {
                        content += delta.content;
                        yield { content: delta.content };
                    }
                    if (delta?.reasoning_content) {
                        yield { thought: delta.reasoning_content, signature: '' };
                    }
                    for (const call of delta?.tool_calls ?? []) {
                        const index = call.index ?? 0;
                        const previous = toolCalls.get(index);
                        // Theia needs a concrete ToolCallChatResponseContent before it
                        // can merge argument deltas or execute the handler.  OpenAI
                        // streams commonly send the function name and its arguments in
                        // the same first delta.  Emitting only an argumentsDelta in that
                        // case silently drops it, leaving the tool runner with nothing
                        // to match ("Tool call content ... not found in the response").
                        // Create the empty shell first, then append the delta below.
                        if (!previous) {
                            const callId = call.id ?? `strigoi-tool-${index}`;
                            const initial: ToolCall = {
                                id: callId,
                                function: {
                                    name: call.function?.name,
                                    arguments: ''
                                }
                            };
                            toolCalls.set(index, initial);
                            yield { tool_calls: [initial] };
                        }
                        const known = toolCalls.get(index)!;
                        const argumentsDelta = call.function?.arguments ?? '';
                        const updated: ToolCall = {
                            id: call.id ?? known.id ?? `strigoi-tool-${index}`,
                            function: {
                                name: call.function?.name ?? known.function?.name,
                                arguments: `${known.function?.arguments ?? ''}${argumentsDelta}`
                            }
                        };
                        toolCalls.set(index, updated);
                        if (argumentsDelta) {
                            yield { tool_calls: [{ ...updated, argumentsDelta: true }] };
                        }
                    }
                    if (payload.usage?.prompt_tokens !== undefined && payload.usage.completion_tokens !== undefined) {
                        yield { input_tokens: payload.usage.prompt_tokens, output_tokens: payload.usage.completion_tokens };
                    }
                }
            }
            // A compliant SSE server normally ends every event with a blank
            // line. Keep the final event nevertheless: losing a trailing
            // finish_reason or [DONE] used to make a completed response look
            // indistinguishable from a truncated stream.
            const trailingData = buffer.split('\n').find(line => line.startsWith('data: '))?.slice(6);
            if (trailingData === '[DONE]') {
                sawDone = true;
            } else if (trailingData) {
                const payload = JSON.parse(trailingData) as OpenAiStreamChunk;
                const choice = payload.choices?.[0];
                if (choice?.finish_reason) {
                    finishReason = choice.finish_reason;
                }
                if (payload.usage?.prompt_tokens !== undefined && payload.usage.completion_tokens !== undefined) {
                    yield { input_tokens: payload.usage.prompt_tokens, output_tokens: payload.usage.completion_tokens };
                }
            }
            return { finishReason, sawDone, content, toolCalls: Array.from(toolCalls.values()) };
        } finally {
            reader.releaseLock();
        }
    }

    protected mapRequestError(error: unknown, aborted: boolean): Error {
        if (aborted) {
            return new Error('A geração local foi cancelada.');
        }
        return error instanceof Error ? error : new Error(String(error));
    }

    protected toOpenAiMessage(message: LanguageModelMessage): OpenAiMessage | undefined {
        if (LanguageModelMessage.isTextMessage(message)) {
            return { role: message.actor === 'ai' ? 'assistant' : message.actor, content: message.text };
        }
        if (LanguageModelMessage.isToolResultMessage(message)) {
            return { role: 'tool', tool_call_id: message.tool_use_id, content: formatToolCallContentForModel(message.content) };
        }
        if (LanguageModelMessage.isToolUseMessage(message)) {
            return {
                role: 'assistant',
                content: '',
                tool_calls: [{ id: message.id, type: 'function', function: { name: message.name, arguments: JSON.stringify(message.input) } }]
            };
        }
        if (LanguageModelMessage.isThinkingMessage(message)) {
            // Reasoning is transient UI state, not chat history.  Sending
            // prior chain-of-thought back to the model wastes most of the
            // context window and can make an otherwise short chat overflow.
            return undefined;
        }
        return { role: message.actor === 'ai' ? 'assistant' : 'user', content: '' };
    }

    protected toOpenAiTool(tool: ToolRequest): Record<string, unknown> {
        return {
            type: 'function',
            function: { name: tool.name, description: tool.description, parameters: tool.parameters }
        };
    }

    protected toResponseFormat(request: UserRequest): Record<string, unknown> | undefined {
        if (request.response_format?.type === 'json_object') {
            return { type: 'json_object' };
        }
        if (request.response_format?.type === 'json_schema') {
            return { ...request.response_format };
        }
        return undefined;
    }
}
