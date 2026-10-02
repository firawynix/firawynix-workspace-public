export type WorkspaceFileKind = 'directory' | 'file';
export const GET_WORKSPACE_ROOTS_FUNCTION_ID = 'getWorkspaceRoots';

export interface WorkspaceListEntry {
    /** The path emitted by WorkspaceFunctionScope, normally `rootName/relative/path`. */
    workspaceRelativePath?: string;
    /** Stable external URI when the entry does not belong to an open workspace root. */
    externalPath: string;
    kind: WorkspaceFileKind;
}

export type WorkspaceListSelection =
    | { type: 'active-root'; rootName: string }
    | { type: 'path'; path: string }
    | { type: 'error'; error: string };

/** Runtime validation for the tool's `path?: string` contract. */
export function parseWorkspaceListArguments(argument: string): { path?: string } | { error: string } {
    let value: unknown;
    try {
        value = JSON.parse(argument);
    } catch {
        return { error: 'Invalid arguments: expected a JSON object with an optional string property "path".' };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { error: 'Invalid arguments: expected a JSON object with an optional string property "path".' };
    }
    const args = value as Record<string, unknown>;
    if (Object.keys(args).some(key => key !== 'path')) {
        return { error: 'Invalid arguments: only the optional string property "path" is accepted.' };
    }
    if (args.path !== undefined && typeof args.path !== 'string') {
        return { error: 'Invalid argument "path": expected a string or omission; nested objects are not valid paths.' };
    }
    return args.path === undefined ? {} : { path: args.path };
}

/** Resolve root semantics before asking the filesystem to resolve a directory. */
export function selectWorkspaceListPath(path: string | undefined, rootNames: readonly string[]): WorkspaceListSelection {
    if (rootNames.length === 0) {
        return { type: 'error', error: 'No workspace has been opened yet' };
    }
    if (path === undefined || path === '' || path === '.') {
        if (rootNames.length > 1) {
            return { type: 'error', error: 'Multiple workspace roots are open. Call getWorkspaceRoots and pass one returned path to getWorkspaceFileList.' };
        }
        return { type: 'active-root', rootName: rootNames[0] };
    }
    return { type: 'path', path };
}

/**
 * Convert a scope-relative entry into the canonical API path. A single root emits short paths
 * (`training`); multi-root keeps the root name so each emitted key remains reusable literally.
 */
export function canonicalWorkspaceEntryPath(entry: WorkspaceListEntry, rootNames: readonly string[]): string {
    if (!entry.workspaceRelativePath) {
        return entry.externalPath;
    }
    if (rootNames.length !== 1) {
        return entry.workspaceRelativePath;
    }
    const prefix = `${rootNames[0]}/`;
    if (entry.workspaceRelativePath === rootNames[0]) {
        return '.';
    }
    return entry.workspaceRelativePath.startsWith(prefix)
        ? entry.workspaceRelativePath.slice(prefix.length)
        : entry.workspaceRelativePath;
}

export function buildWorkspaceDirectoryListing(entries: readonly WorkspaceListEntry[], rootNames: readonly string[]): Record<string, WorkspaceFileKind> {
    return entries.reduce<Record<string, WorkspaceFileKind>>((result, entry) => {
        result[canonicalWorkspaceEntryPath(entry, rootNames)] = entry.kind;
        return result;
    }, {});
}

/** The workspace root is a listing boundary, never an entry to evaluate against `.gitignore`. */
export function isWorkspaceRootResource(resource: string, rootResources: readonly string[]): boolean {
    return rootResources.includes(resource);
}
