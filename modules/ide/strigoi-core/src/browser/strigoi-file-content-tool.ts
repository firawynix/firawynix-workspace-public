import { ResolvedAIContextVariable, ToolInvocationContext, ToolProvider, ToolRequest } from '@theia/ai-core';
import { ChatToolContext } from '@theia/ai-chat';
import { WorkspaceFunctionScope, FileContentFunction } from '@theia/ai-ide/lib/browser/workspace-functions';
import { FILE_CONTENT_FUNCTION_ID } from '@theia/ai-ide/lib/common/workspace-functions';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MAX_CHAT_ATTACHMENT_BYTES } from './strigoi-document-content';
import { readStrigoiFileTool } from '../common/filesystem-tool-engine';

@injectable()
export class StrigoiFileContentTool implements ToolProvider {
    @inject(FileService) protected readonly fileService: FileService;
    @inject(WorkspaceFunctionScope) protected readonly scope: WorkspaceFunctionScope;
    @inject(FileContentFunction) protected readonly sourceReader: FileContentFunction;
    @inject(EnvVariablesServer) protected readonly environment: EnvVariablesServer;

    getTool(): ToolRequest {
        const original = this.sourceReader.getTool();
        return {
            ...original,
            id: FILE_CONTENT_FUNCTION_ID,
            description: 'Reads the exact file at a workspace-relative, root-prefixed, absolute local path or file:// URI. ' +
                'Extracts text from DOCX, PDF and supported Office documents. Reads current attached files by their exact reference, ' +
                'including files outside the workspace. Reads skill files under the current user .agents/skills. ' +
                'Other external files require allowedExternalPaths. Never replace a missing document with README or another file. ' +
                'For source files, preserves unsaved editor content and reviewed-edit tracking. Optional offset/limit are line-based.',
            handler: (argument: string, context?: ToolInvocationContext) => readStrigoiFileTool(argument, {
                resolve: async path => {
                    const uri = await this.scope.resolveToUri(path);
                    if (!uri) { throw new Error(`Invalid file path '${path}'`); }
                    return uri;
                },
                ensureAccessible: uri => this.scope.ensureAccessible(uri),
                skillRoots: async () => {
                    const [home, config] = await Promise.all([this.environment.getHomeDirUri(), this.environment.getConfigDirUri()]);
                    return [new URI(home).resolve('.agents/skills'), new URI(config).resolve('skills')];
                },
                readBytes: async uri => {
                    const stat = await this.fileService.resolve(uri);
                    if (stat.isDirectory) { throw new Error(`Expected a file, received a directory: ${uri.toString()}`); }
                    if (stat.size !== undefined && stat.size > MAX_CHAT_ATTACHMENT_BYTES) { throw new Error('File exceeds the 20 MB document read limit.'); }
                    return (await this.fileService.readFile(uri)).value.buffer;
                },
                readSource: async (args, ctx) => original.handler(args, ctx)
            }, context, ChatToolContext.is(context)
                ? Array.from(new Map([...context.request.context.variables, ...context.request.message.variables.filter(ResolvedAIContextVariable.is)]
                    .map(variable => [JSON.stringify([variable.value, variable.contextValue]), variable])).values()) : [])
        };
    }
}
