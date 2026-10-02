import { formatToolCallContentForModel, hasToolCallError, ToolInvocationContext, ToolInvocationRegistry } from '@theia/ai-core';

interface PlanningPart {
    promptText: string;
    kind?: string;
    variableName?: string;
    variableArg?: string;
}

const LOAD_SKILL_COMMAND = /Load the skill ([\w./:-]+) using ~?\{?getSkillFileContent\}?\.?/gi;

export function selectedPlanningSkills(parts: readonly PlanningPart[]): string[] {
    return [...new Set(parts.flatMap(part => {
        if (part.kind === 'var' && part.variableName === 'prompt' && part.variableArg
            && /getSkillFileContent/.test(part.promptText)) {
            return [part.variableArg.split('|')[0]];
        }
        return Array.from(part.promptText.matchAll(LOAD_SKILL_COMMAND), match => match[1]);
    }))];
}

/** Preparation runs in the host, not as a task the LLM must invent or schedule. */
export async function preparePlanningSkills(
    parts: readonly PlanningPart[],
    registry: Pick<ToolInvocationRegistry, 'getFunction'>,
    context: ToolInvocationContext
): Promise<string> {
    const skills = selectedPlanningSkills(parts);
    if (!skills.length) { return ''; }
    const tool = registry.getFunction('getSkillFileContent');
    if (!tool) { throw new Error('A ferramenta de leitura de skills não está disponível.'); }
    const contents: string[] = [];
    for (const skillName of skills) {
        if (context.cancellationToken?.isCancellationRequested) { throw new Error('Preparação cancelada.'); }
        const result = await tool.handler(JSON.stringify({ skillName }), context);
        const text = formatToolCallContentForModel(result);
        let structuredError: unknown;
        try { structuredError = JSON.parse(text)?.error; } catch { /* Skill instructions are plain text. */ }
        if (hasToolCallError(result) || structuredError || !text.trim() || /^(Error|Skill .*not found)/i.test(text)) {
            throw new Error(`Não foi possível carregar a skill '${skillName}': ${structuredError || text}`);
        }
        contents.push(`Selected skill '${skillName}' was read by the host. Apply these instructions to the requested deliverable; loading is NOT the objective.\n${text}`);
    }
    return contents.join('\n\n');
}

export function applyPreparedSkillContext(text: string, skillContext: string): string {
    if (!skillContext) { return text; }
    return `${text.replace(LOAD_SKILL_COMMAND, 'Apply the selected skill $1 to the requested deliverable using the supplied sources.')}\n\n${skillContext}\n\nRequested scope: produce the artifact defined by the selected skill. In Planning mode, plan that artifact only, not implementation of the business feature described by the source documents. Skill loading and source reading are preparation already performed, never the goal. Keep the plan to 3–8 concise numbered items (no wide tables), in Portuguese when the request has no natural-language sentence. Directory listings prove paths only, not metadata definitions, file contents or org state. Explicitly mark uninspected code and design choices as pending/proposed, not confirmed.`;
}

export async function preparePlanningWorkspace(registry: Pick<ToolInvocationRegistry, 'getFunction'>, context: ToolInvocationContext): Promise<string> {
    const rootsTool = registry.getFunction('getWorkspaceRoots');
    const listTool = registry.getFunction('getWorkspaceFileList');
    if (!rootsTool) { return ''; }
    const roots = formatToolCallContentForModel(await rootsTool.handler('{}', context));
    const parsed = JSON.parse(roots);
    if (parsed.error) { throw new Error(`Preparação do workspace: ${parsed.error}`); }
    let listing = '';
    if (parsed.roots?.length === 1 && listTool) {
        listing = formatToolCallContentForModel(await listTool.handler('{}', context));
        try {
            const result = JSON.parse(listing);
            if (result.error) { throw new Error(`Preparação do workspace: ${result.error}`); }
        } catch (error) {
            if (!(error instanceof SyntaxError)) { throw error; }
        }
    }
    return `Workspace preflight already performed by the host. Do not repeat roots/root-directory discovery. These are paths only, not inspected file contents or deployed org state.\nRoots: ${roots}\nTop-level listing: ${listing || 'not listed'}\n`;
}

interface CheckpointRequest {
    response: {
        isComplete: boolean;
        isError: boolean;
        isCanceled: boolean;
        response: { content: readonly { kind: string; asString?(): string | undefined }[] };
    };
}

/** Old preparation-only plans and interrupted responses are not executable checkpoints. */
export function completedPlanCheckpoint(request: CheckpointRequest): string | undefined {
    if (!request.response.isComplete || request.response.isError || request.response.isCanceled) { return undefined; }
    const text = request.response.response.content
        .filter(content => content.kind === 'markdownContent' || content.kind === 'text')
        .map(content => content.asString?.() ?? '').join('\n');
    const checkpoint = text.match(/<!--\s*strigoi-plan-checkpoint([\s\S]*?)-->/i)?.[1];
    const objective = checkpoint?.match(/^objective:\s*(.+)$/mi)?.[1];
    if (!checkpoint || !objective || !/^next:\s*\S.+$/mi.test(checkpoint)
        || /^(load|carregar|read|ler)\b.*\b(skill|document)/i.test(objective)) { return undefined; }
    return checkpoint;
}
