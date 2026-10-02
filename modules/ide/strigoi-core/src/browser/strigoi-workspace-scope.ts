import { WorkspaceFunctionScope } from '@theia/ai-ide/lib/browser/workspace-functions';
import URI from '@theia/core/lib/common/uri';
import { injectable } from '@theia/core/shared/inversify';
import { resolveStrigoiPath } from '../common/filesystem-tool-engine';

@injectable()
export class StrigoiWorkspaceScope extends WorkspaceFunctionScope {
    // Read live roots, not a map potentially cached before workspace restoration finished.
    override getRootMapping(): Map<string, URI> {
        const mapping = new Map<string, URI>();
        for (const root of this.workspaceService.tryGetRoots()) {
            if (!mapping.has(root.resource.path.base)) { mapping.set(root.resource.path.base, root.resource); }
        }
        return mapping;
    }

    override async resolveToUri(input: string | URI): Promise<URI | undefined> {
        await this.workspaceService.ready;
        if (input instanceof URI) { return input.normalizePath(); }
        return resolveStrigoiPath(input, this.workspaceService.tryGetRoots().map(root => root.resource), await this.getHomeDirUri());
    }

    override async ensureAccessible(target: URI): Promise<void> {
        await this.workspaceService.ready;
        if (this.isUnderAny(this.workspaceService.tryGetRoots().map(root => root.resource), target.normalizePath())) { return; }
        await super.ensureAccessible(target);
    }

    override getContainingRoot(uri: URI): URI | undefined {
        return this.workspaceService.tryGetRoots().map(root => root.resource)
            .filter(root => root.isEqualOrParent(uri, WorkspaceFunctionScope.pathCaseSensitive))
            .sort((a, b) => b.path.toString().length - a.path.toString().length)[0];
    }

    override toWorkspaceRelativePath(uri: URI): string | undefined {
        const root = this.getContainingRoot(uri);
        if (!root) { return undefined; }
        // URI.relative is case-sensitive even on Windows (D: versus d:).
        const relative = uri.path.toString().slice(root.path.toString().length).replace(/^\//, '');
        return relative ? `${root.path.base}/${relative}` : root.path.base;
    }

    override isInWorkspace(uri: URI): boolean {
        return this.isUnderAny(this.workspaceService.tryGetRoots().map(root => root.resource), uri.normalizePath());
    }

    override isInPrimaryWorkspace(uri: URI): boolean {
        return this.isUnderAny(this.workspaceService.tryGetRoots().slice(0, 1).map(root => root.resource), uri.normalizePath());
    }
}
