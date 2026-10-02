import { ToolInvocationContext, ToolInvocationRegistry, ToolProvider, ToolRequest } from '@theia/ai-core';
import { CancellationToken, URI } from '@theia/core';
import { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { FILE_CONTENT_FUNCTION_ID, GET_SKILL_FILE_CONTENT_FUNCTION_ID, GET_WORKSPACE_FILE_LIST_FUNCTION_ID } from '@theia/ai-ide/lib/common/workspace-functions';
import { StrigoiFileContentTool } from './strigoi-file-content-tool';
import { SkillService } from '@theia/ai-core/lib/browser/skill-service';
import { WorkspaceFunctionScope } from '@theia/ai-ide/lib/browser/workspace-functions';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    buildWorkspaceDirectoryListing,
    GET_WORKSPACE_ROOTS_FUNCTION_ID,
    isWorkspaceRootResource,
    parseWorkspaceListArguments,
    selectWorkspaceListPath,
    WorkspaceFileKind
} from '../common/workspace-tool-contract';

/** A distinct name keeps multi-root discovery explicit instead of overloading root listing. */
export { GET_WORKSPACE_ROOTS_FUNCTION_ID } from '../common/workspace-tool-contract';

@injectable()
export class StrigoiWorkspaceFileListTool implements ToolProvider {
    static readonly ID = GET_WORKSPACE_FILE_LIST_FUNCTION_ID;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceFunctionScope)
    protected readonly workspaceScope: WorkspaceFunctionScope;

    getTool(): ToolRequest {
        return {
            id: StrigoiWorkspaceFileListTool.ID,
            name: StrigoiWorkspaceFileListTool.ID,
            description: 'Lists immediate files and directories in a workspace directory. With no path, ".", or "", lists the active workspace root when exactly one workspace is open. ' +
                'Every directory key returned is a canonical path that can be passed literally to getWorkspaceFileList or other compatible workspace tools. ' +
                'For multiple workspace roots, call getWorkspaceRoots first and use one of its path values.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Optional canonical workspace path. Use no path, "", or "." for the active root in a single-root workspace. ' +
                            'In a multi-root workspace, use the path returned by getWorkspaceRoots or a canonical path returned by this tool.'
                    }
                }
            },
            handler: (argument: string, context?: ToolInvocationContext) => this.handle(argument, context?.cancellationToken)
        };
    }

    async handle(argument: string, cancellationToken?: CancellationToken): Promise<string> {
        const parsed = parseWorkspaceListArguments(argument);
        if ('error' in parsed) {
            return JSON.stringify({ error: parsed.error });
        }
        return this.getProjectFileList(parsed.path, cancellationToken);
    }

    async getProjectFileList(path?: string, cancellationToken?: CancellationToken): Promise<string> {
        if (cancellationToken?.isCancellationRequested) {
            return JSON.stringify({ error: 'Operation cancelled by user' });
        }
        const roots = this.workspaceScope.getRootMapping();
        try {
            const selection = selectWorkspaceListPath(path, Array.from(roots.keys()));
            if (selection.type === 'error') {
                return JSON.stringify({ error: selection.error });
            }
            if (selection.type === 'active-root') {
                const root = roots.get(selection.rootName)!;
                return this.resolveAndList(root, cancellationToken);
            }
            const target = await this.workspaceScope.resolveAccessiblePath(selection.path);
            return this.resolveAndList(target, cancellationToken);
        } catch (error) {
            return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
        }
    }

    protected async resolveAndList(target: URI, cancellationToken?: CancellationToken): Promise<string> {
        if (cancellationToken?.isCancellationRequested) {
            return JSON.stringify({ error: 'Operation cancelled by user' });
        }
        const stat = await this.fileService.resolve(target);
        if (!stat?.isDirectory) {
            return JSON.stringify({ error: 'Directory not found' });
        }
        return this.listFilesDirectly(stat, cancellationToken);
    }

    protected async listFilesDirectly(stat: FileStat, cancellationToken?: CancellationToken): Promise<string> {
        const entries: Array<{ workspaceRelativePath?: string; externalPath: string; kind: WorkspaceFileKind }> = [];
        const rootNames = Array.from(this.workspaceScope.getRootMapping().keys());
        const rootResources = Array.from(this.workspaceScope.getRootMapping().values()).map(root => root.toString());
        // `stat` can be the workspace root when the caller omitted `path`. Do not pass the
        // root itself to `shouldExclude`: its gitignore implementation turns that relative
        // path into "/", which the `ignore` package correctly rejects. Only children are
        // candidates for user- and gitignore-based exclusion.
        if (!isWorkspaceRootResource(stat.resource.toString(), rootResources) && await this.workspaceScope.shouldExclude(stat)) {
            return JSON.stringify({});
        }
        for (const child of stat.children ?? []) {
            if (cancellationToken?.isCancellationRequested) {
                return JSON.stringify({ error: 'Operation cancelled by user' });
            }
            if (await this.workspaceScope.shouldExclude(child)) {
                continue;
            }
            entries.push({
                workspaceRelativePath: this.workspaceScope.toWorkspaceRelativePath(child.resource),
                externalPath: child.resource.toString(),
                kind: child.isDirectory ? 'directory' : 'file'
            });
        }
        return JSON.stringify(buildWorkspaceDirectoryListing(entries, rootNames));
    }

}

@injectable()
export class StrigoiWorkspaceRootsTool implements ToolProvider {
    @inject(WorkspaceFunctionScope)
    protected readonly workspaceScope: WorkspaceFunctionScope;

    getTool(): ToolRequest {
        return {
            id: GET_WORKSPACE_ROOTS_FUNCTION_ID,
            name: GET_WORKSPACE_ROOTS_FUNCTION_ID,
            description: 'Lists open workspace roots. Use a returned path literally with getWorkspaceFileList in a multi-root workspace.',
            parameters: { type: 'object', properties: {} },
            handler: async (argument: string) => this.handle(argument)
        };
    }

    protected handle(argument: string): string {
        let parsed: unknown;
        try {
            parsed = JSON.parse(argument);
        } catch {
            return JSON.stringify({ error: 'Invalid arguments: getWorkspaceRoots accepts an empty JSON object.' });
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed as object).length > 0) {
            return JSON.stringify({ error: 'Invalid arguments: getWorkspaceRoots accepts an empty JSON object.' });
        }
        return JSON.stringify({ roots: Array.from(this.workspaceScope.getRootMapping()).map(([name, uri]) => ({ name, path: name, uri: uri.toString(), absolutePath: uri.path.fsPath() })) });
    }
}

/**
 * Theia registers upstream ToolProviders before extensions start. Swap only the file-list entry
 * after startup, preserving upstream providers for source-file read tracking.
 */
@injectable()
export class StrigoiWorkspaceToolContribution implements FrontendApplicationContribution {
    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry: ToolInvocationRegistry;

    @inject(StrigoiWorkspaceFileListTool)
    protected readonly fileListTool: StrigoiWorkspaceFileListTool;

    @inject(StrigoiWorkspaceRootsTool)
    protected readonly rootsTool: StrigoiWorkspaceRootsTool;

    @inject(StrigoiFileContentTool)
    protected readonly fileContentTool: StrigoiFileContentTool;

    @inject(SkillService)
    protected readonly skillService: SkillService;

    onStart(_app: FrontendApplication): void {
        this.toolRegistry.unregisterTool(GET_WORKSPACE_FILE_LIST_FUNCTION_ID);
        this.toolRegistry.registerTool(this.fileListTool.getTool());
        this.toolRegistry.registerTool(this.rootsTool.getTool());
        this.toolRegistry.unregisterTool(FILE_CONTENT_FUNCTION_ID);
        this.toolRegistry.registerTool(this.fileContentTool.getTool());
        const skillTool = this.toolRegistry.getFunction(GET_SKILL_FILE_CONTENT_FUNCTION_ID);
        if (skillTool) {
            this.toolRegistry.unregisterTool(skillTool.id);
            this.toolRegistry.registerTool({ ...skillTool, handler: async (argument, context) => {
                await this.skillService.ready;
                const result = await skillTool.handler(argument, context);
                const skill = this.skillService.getSkill(JSON.parse(argument).skillName);
                return typeof result === 'string' && skill
                    ? `Skill source: ${URI.fromFilePath(skill.location).toString()}\nResolve relative supporting files against this skill's directory.\n\n${result}`
                    : result;
            } });
        }
    }
}
