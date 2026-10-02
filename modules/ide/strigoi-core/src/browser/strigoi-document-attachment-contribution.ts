import {
    AIVariableContext,
    AIVariableResolutionRequest,
    AIVariableResolver,
    ResolvedAIContextVariable
} from '@theia/ai-core';
import { AIVariableDropResult, FrontendVariableContribution, FrontendVariableService } from '@theia/ai-core/lib/browser';
import { FILE_VARIABLE } from '@theia/ai-core/lib/browser/file-variable-contribution';
import { ILogger, MessageService, URI } from '@theia/core';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceFunctionScope } from '@theia/ai-ide/lib/browser/workspace-functions';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { extractStrigoiDocumentText, formatStrigoiDocumentContext, MAX_CHAT_ATTACHMENT_BYTES } from './strigoi-document-content';

interface DroppedDocument {
    name: string;
    text: string;
}

@injectable()
export class StrigoiDocumentAttachmentContribution implements FrontendVariableContribution, AIVariableResolver {
    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceFunctionScope)
    protected readonly workspaceScope: WorkspaceFunctionScope;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    @inject(ILogger) @named('ai-core:DefaultFrontendVariableService')
    protected readonly logger: ILogger;

    protected readonly droppedDocuments = new Map<string, DroppedDocument>();
    protected nextAttachmentId = 1;

    registerVariables(service: FrontendVariableService): void {
        service.registerResolver(FILE_VARIABLE, this);
        service.registerDropHandler(this.handleDrop.bind(this));
    }

    canResolve(request: AIVariableResolutionRequest): number {
        if (request.variable.name !== FILE_VARIABLE.name || !request.arg) {
            return 0;
        }
        if (this.droppedDocuments.has(request.arg)) {
            return 100;
        }
        return this.isSupportedFile(request.arg) ? 10 : 0;
    }

    async resolve(request: AIVariableResolutionRequest, _context: AIVariableContext): Promise<ResolvedAIContextVariable | undefined> {
        if (request.variable.name !== FILE_VARIABLE.name || !request.arg) {
            return undefined;
        }

        const dropped = this.droppedDocuments.get(request.arg);
        if (dropped) {
            return {
                variable: request.variable,
                value: dropped.name,
                contextValue: formatStrigoiDocumentContext(dropped.name, dropped.text)
            };
        }

        try {
            const uri = await this.toUri(request.arg);
            if (!uri) { throw new Error(`File not found at exact path '${request.arg}'.`); }
            const stat = await this.fileService.resolve(uri);
            if (!stat || stat.isDirectory) {
                return undefined;
            }
            const content = await this.readDocument(uri, stat);
            return {
                variable: request.variable,
                value: uri.toString(),
                contextValue: formatStrigoiDocumentContext(uri.displayName, content)
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Could not read attached document '${request.arg}': ${message}`);
            await this.messageService.warn(`Não foi possível ler o documento anexado '${request.arg}': ${message}`);
            return undefined;
        }
    }

    protected async handleDrop(event: DragEvent): Promise<AIVariableDropResult | undefined> {
        const dataTransfer = event.dataTransfer;
        const files = dataTransfer?.files;
        if (!dataTransfer || !files?.length || dataTransfer.getData('theia-editor-dnd')) {
            return undefined;
        }

        const variables: AIVariableResolutionRequest[] = [];
        const references: string[] = [];
        for (const file of Array.from(files).slice(0, 5)) {
            try {
                if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
                    throw new Error('o limite por arquivo é 20 MB');
                }
                const text = await extractStrigoiDocumentText(new Uint8Array(await file.arrayBuffer()), file.name);
                const id = `strigoi-drop-${this.nextAttachmentId++}`;
                this.droppedDocuments.set(id, { name: file.name, text });
                variables.push({ variable: FILE_VARIABLE, arg: id });
                references.push(`#file:${id}`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await this.messageService.warn(`O arquivo '${file.name}' não foi anexado: ${message}`);
            }
        }

        return variables.length ? { variables, text: references.join(' ') } : undefined;
    }

    protected async readDocument(uri: URI, stat: FileStat): Promise<string> {
        if (stat.size !== undefined && stat.size > MAX_CHAT_ATTACHMENT_BYTES) {
            throw new Error('o limite por arquivo é 20 MB');
        }
        const fileContent = await this.fileService.readFile(uri);
        if (fileContent.value.byteLength > MAX_CHAT_ATTACHMENT_BYTES) {
            throw new Error('o limite por arquivo é 20 MB');
        }
        return extractStrigoiDocumentText(fileContent.value.buffer, uri.displayName);
    }

    protected isSupportedFile(path: string): boolean {
        const fileName = path.split(/[\\/]/).pop() ?? path;
        return /\.[\w-]+$/.test(fileName);
    }

    protected async toUri(pathString: string): Promise<URI | undefined> {
        const uri = await this.workspaceScope.resolveToUri(pathString);
        return uri && await this.fileService.exists(uri) ? uri : undefined;
    }
}
