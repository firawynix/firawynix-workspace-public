interface ResolvedTextContext {
    variable: { name: string };
    contextValue?: string;
}

interface RequestWithResolvedContext {
    message: { parts: Array<{ promptText: string; resolution?: ResolvedTextContext }>; variables?: readonly ResolvedTextContext[] };
    context: { variables: ResolvedTextContext[] };
}

export function getAttachedFileContexts(request: RequestWithResolvedContext): string[] {
    // Inline #file references are resolved by the parser, separately from
    // composer chips. Both paths must reach the actual inference payload.
    const variables = [...request.context.variables, ...(request.message.variables ?? []),
        ...request.message.parts.flatMap(part => part.resolution ? [part.resolution] : [])];
    return [...new Set(variables.filter(variable => variable.variable.name === 'file' && typeof variable.contextValue === 'string')
        .map(variable => variable.contextValue!.trim()).filter(Boolean))];
}

interface TextModelMessage {
    actor: string;
    type: string;
    text?: string;
}

/**
 * Theia keeps resolved context values beside a request, but its default message
 * serializer only sends images to the model. Add attached #file contents to the
 * matching user message so a visible attachment is also actual model context.
 */
export function appendAttachedFileContexts<T extends TextModelMessage>(
    messages: T[],
    requests: readonly RequestWithResolvedContext[]
): T[] {
    let searchFrom = 0;

    for (const request of requests) {
        const promptText = request.message.parts.map(part => part.promptText).join('');
        const contexts = getAttachedFileContexts(request);
        if (contexts.length === 0) {
            continue;
        }

        const userMessageIndex = promptText.length > 0
            ? messages.findIndex((message, index) => index >= searchFrom
                && message.actor === 'user'
                && message.type === 'text'
                && message.text === promptText)
            : -1;
        const addition = contexts.join('\n\n');

        if (userMessageIndex >= 0) {
            const message = messages[userMessageIndex];
            message.text = `${message.text ?? ''}\n\n${addition}`;
            searchFrom = userMessageIndex + 1;
        } else {
            const inserted = {
                actor: 'user',
                type: 'text',
                text: addition
            } as T;
            messages.splice(searchFrom, 0, inserted);
            searchFrom++;
        }
    }

    return messages;
}

interface ContextVariableManager {
    getVariables(): readonly { variable: { name: string } }[];
    deleteVariables(...indices: number[]): void;
}

/** Retire sent file chips from the composer without changing the saved request. */
export function clearConsumedFileAttachments(context: ContextVariableManager): void {
    const fileIndices = context.getVariables()
        .flatMap((variable, index) => variable.variable.name === 'file' ? [index] : []);
    if (fileIndices.length > 0) {
        context.deleteVariables(...fileIndices);
    }
}
