import { ChatContext, ChatRequest } from '@theia/ai-chat/lib/common';
import { ChatRequestParser, ChatRequestParserImpl } from '@theia/ai-chat/lib/common/chat-request-parser';
import { ChatAgentLocation } from '@theia/ai-chat/lib/common/chat-agents';
import { inject, injectable } from '@theia/core/shared/inversify';

/**
 * The chat input can serialize adjacent prompt and file chips without a
 * separator. The upstream parser only recognizes a new #variable after
 * whitespace, so normalize this specific pair before delegating parsing.
 */
export function normalizeAdjacentPromptFileReferences(text: string): string {
    return text.replace(/(#prompt:[\w.:-]+)(?=#file:)/gi, '$1 ');
}

@injectable()
export class StrigoiChatRequestParser implements ChatRequestParser {
    @inject(ChatRequestParserImpl)
    protected readonly delegate: ChatRequestParserImpl;

    parseChatRequest(request: ChatRequest, location: ChatAgentLocation, context: ChatContext) {
        const text = normalizeAdjacentPromptFileReferences(request.text);
        const normalizedRequest = text === request.text ? request : { ...request, text };
        return this.delegate.parseChatRequest(normalizedRequest, location, context);
    }
}
