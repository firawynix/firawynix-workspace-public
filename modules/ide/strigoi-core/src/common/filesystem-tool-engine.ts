import URI from '@theia/core/lib/common/uri';
import type { ToolCallResult, ToolInvocationContext } from '@theia/ai-core/lib/common/language-model';
import { extractStrigoiDocumentText, MAX_CHAT_ATTACHMENT_BYTES } from '../browser/strigoi-document-content';

/** One path contract for chat attachments and every workspace tool. Never search for a substitute file. */
export function resolveStrigoiPath(input: string, roots: URI[], home?: URI): URI {
    if (typeof input !== 'string' || !input.trim()) {
        throw new Error('A non-empty file or directory path is required.');
    }
    const path = input.trim().replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(path) || path.startsWith('/')) {
        return URI.fromFilePath(path).normalizePath();
    }
    if (/^[a-zA-Z][\w+.-]*:/.test(path)) {
        const uri = new URI(path).normalizePath();
        if (uri.scheme !== 'file') {
            throw new Error(`Unsupported filesystem URI scheme '${uri.scheme}'. Use a local path or file:// URI.`);
        }
        return uri;
    }
    if (path === '~' || path.startsWith('~/')) {
        if (!home) { throw new Error('The user home directory is unavailable.'); }
        return path === '~' ? home : home.resolve(path.slice(2)).normalizePath();
    }
    const relative = path.replace(/^(\.\/)+/, '');
    const matches = roots.filter(root => relative === root.path.base || relative.startsWith(`${root.path.base}/`));
    if (matches.length === 1) {
        const suffix = relative.slice(matches[0].path.base.length).replace(/^\//, '');
        return suffix ? matches[0].resolve(suffix).normalizePath() : matches[0];
    }
    if (matches.length > 1 || roots.length > 1) {
        throw new Error(`Ambiguous workspace path '${input}'. Use an absolute path or file:// URI. Roots: ${roots.map(root => root.toString()).join(', ')}`);
    }
    if (!roots.length) { throw new Error('No workspace is open. Use an absolute path or attach the local file.'); }
    return roots[0].resolve(relative === '.' ? '' : relative).normalizePath();
}

export interface FileToolServices {
    resolve(path: string): Promise<URI>;
    ensureAccessible(uri: URI): Promise<void>;
    skillRoots(): Promise<URI[]>;
    readBytes(uri: URI): Promise<Uint8Array>;
    readSource(argument: string, context?: ToolInvocationContext): Promise<ToolCallResult>;
}

interface FileAttachment {
    variable: { name: string };
    arg?: string;
    value?: string;
    contextValue?: string;
}

export async function readStrigoiFileTool(argument: string, services: FileToolServices,
    context?: ToolInvocationContext, attachments: readonly FileAttachment[] = []): Promise<ToolCallResult> {
    let file: string | undefined;
    let target: URI | undefined;
    try {
        const parsed = JSON.parse(argument);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.file !== 'string' || !parsed.file.trim()) {
            throw new Error('getFileContent requires {"file":"exact path"}.');
        }
        file = parsed.file;
        if (parsed.offset !== undefined && (!Number.isInteger(parsed.offset) || parsed.offset < 0)) {
            throw new Error('offset must be a non-negative integer.');
        }
        if (parsed.limit !== undefined && (!Number.isInteger(parsed.limit) || parsed.limit <= 0)) {
            throw new Error('limit must be a positive integer.');
        }
        if (context?.cancellationToken?.isCancellationRequested) { throw new Error('Operation cancelled by user'); }
        // Only attachments from THIS request qualify. A filename alone never authorizes unrelated filesystem access.
        const attached = attachments.filter(item => item.variable.name === 'file'
            && (item.arg === file || item.value === file) && typeof item.contextValue === 'string');
        if (attached.length > 1) { throw new Error('Ambiguous attachment name. Use its exact #file reference.'); }
        if (attached.length === 1) { return sliceFileText(attached[0].contextValue!, parsed.offset, parsed.limit); }
        target = await services.resolve(file!);
        // Skill supporting files are readable, but this does not grant write tools access to the user's home.
        const skillRoots = await services.skillRoots();
        const isSkillFile = skillRoots.some(root => root.isEqualOrParent(target!, !/^[\/]?[a-zA-Z]:/.test(target!.path.toString())));
        if (!isSkillFile) { await services.ensureAccessible(target); }
        const officeDocument = /\.(docx|xlsx|pptx|odt|ods|odp|odg|pdf|rtf|epub)$/i.test(target.path.base);
        if (!officeDocument && !isSkillFile) {
            // Preserve unsaved editor contents, source-file size limits and reviewed-edit read tracking.
            return await services.readSource(JSON.stringify({ ...parsed, file: target.toString() }), context);
        }
        const bytes = await services.readBytes(target);
        if (context?.cancellationToken?.isCancellationRequested) { throw new Error('Operation cancelled by user'); }
        if (bytes.byteLength > MAX_CHAT_ATTACHMENT_BYTES) { throw new Error('File exceeds the 20 MB document read limit.'); }
        const text = await extractStrigoiDocumentText(bytes, target.path.base);
        return sliceFileText(text, parsed.offset, parsed.limit);
    } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error), requestedPath: file,
            resolvedUri: target?.toString(), hint: 'Use the exact path returned by getWorkspaceRoots/getWorkspaceFileList or the current attachment reference. Do not substitute README or another file.' });
    }
}

function sliceFileText(text: string, offset?: number, limit?: number): string {
    if (offset === undefined && limit === undefined) { return text; }
    const lines = text.split('\n');
    const start = offset ?? 0;
    return lines.slice(start, limit === undefined ? undefined : start + limit).join('\n');
}
