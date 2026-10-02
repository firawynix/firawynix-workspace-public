/* Optional local-only inference validation. Never writes source documents or prints their content. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const URI = require('@theia/core/lib/common/uri').default;
const { StrigoiAgent, STRIGOI_PLAN_MODE_ID } = require('../strigoi-core/lib/browser/strigoi-agent');
const { preparePlanningSkills, preparePlanningWorkspace, applyPreparedSkillContext, completedPlanCheckpoint } = require('../strigoi-core/lib/browser/strigoi-planning-context');
const { extractStrigoiDocumentText, formatStrigoiDocumentContext } = require('../strigoi-core/lib/browser/strigoi-document-content');
const { resolveStrigoiPath, readStrigoiFileTool } = require('../strigoi-core/lib/common/filesystem-tool-engine');
const { LlamaCppLanguageModel } = require('../strigoi-core/lib/node/llama-cpp-language-model');

async function main() {
    const rootPath = process.env.STRIGOI_TEST_WORKSPACE;
    const documentPath = process.env.STRIGOI_TEST_DOCUMENT;
    assert.ok(rootPath && documentPath, 'Set STRIGOI_TEST_WORKSPACE and STRIGOI_TEST_DOCUMENT for this opt-in local test.');
    const endpoint = process.env.STRIGOI_TEST_ENDPOINT || 'http://127.0.0.1:18789';
    const slots = await (await fetch(`${endpoint}/slots`)).json();
    assert.equal(slots.some(slot => slot.is_processing), false, 'Do not interrupt an active user generation.');
    const root = URI.fromFilePath(rootPath);
    const home = URI.fromFilePath(os.homedir());
    const services = {
        resolve: async file => resolveStrigoiPath(file, [root], home),
        ensureAccessible: async uri => { assert.ok(root.isEqualOrParent(uri, process.platform !== 'win32'), 'Read outside workspace not permitted'); },
        skillRoots: async () => [home.resolve('.agents/skills')],
        readBytes: async uri => new Uint8Array(await fs.readFile(uri.path.fsPath())),
        readSource: async args => fs.readFile(new URI(JSON.parse(args).file).path.fsPath(), 'utf8')
    };
    const parts = [{ kind: 'var', variableName: 'prompt', variableArg: 'jp-tdb', promptText: 'Load the skill jp-tdb using ~{getSkillFileContent}.' }];
    const instructions = await preparePlanningSkills(parts, { getFunction: () => ({ handler: async args => {
        assert.equal(JSON.parse(args).skillName, 'jp-tdb');
        return fs.readFile(path.join(os.homedir(), '.agents', 'skills', 'jp-tdb', 'SKILL.md'), 'utf8');
    } }) }, {});
    const document = await extractStrigoiDocumentText(new Uint8Array(await fs.readFile(documentPath)), path.basename(documentPath));
    const prompt = new StrigoiAgent().prompts[0].variants.find(variant => variant.id === STRIGOI_PLAN_MODE_ID).template;
    const calls = [];
    const tools = [
        { id: 'getWorkspaceRoots', name: 'getWorkspaceRoots', description: 'Get actual open workspace roots.', parameters: { type: 'object', properties: {} },
            handler: async () => JSON.stringify({ roots: [{ name: root.path.base, path: root.toString() }] }) },
        { id: 'getWorkspaceFileList', name: 'getWorkspaceFileList', description: 'List immediate files and directories. Optional path defaults to workspace root.', parameters: { type: 'object', properties: { path: { type: 'string' } } },
            handler: async args => {
                const uri = resolveStrigoiPath(JSON.parse(args).path || '.', [root], home);
                assert.ok(root.isEqualOrParent(uri, process.platform !== 'win32'));
                return JSON.stringify((await fs.readdir(uri.path.fsPath(), { withFileTypes: true })).filter(entry => !entry.name.startsWith('.') && entry.name !== 'node_modules').map(entry => ({ path: uri.resolve(entry.name).toString(), kind: entry.isDirectory() ? 'directory' : 'file' })));
            } },
        { id: 'getFileContent', name: 'getFileContent', description: 'Read an exact workspace file path or URI.', parameters: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] },
            handler: async args => readStrigoiFileTool(args, services) }
    ].map(tool => ({ ...tool, handler: async args => {
        calls.push(tool.id);
        const result = await tool.handler(args);
        console.log(JSON.stringify({ tool: tool.id, resultCharacters: String(result).length }));
        return result;
    } }));
    const preflight = await preparePlanningWorkspace({ getFunction: id => tools.find(tool => tool.id === id) }, {});
    const user = applyPreparedSkillContext(`${parts[0].promptText} ${URI.fromFilePath(documentPath).toString()}\n${formatStrigoiDocumentContext(path.basename(documentPath), document)}`, `${instructions}\n${preflight}`);
    const modelId = process.env.STRIGOI_TEST_MODEL || 'gpt-oss-20b-MXFP4';
    const model = new LlamaCppLanguageModel('local-planning-test', modelId, { status: 'ready' }, () => ({}), {});
    const countTokens = model.countCompletionTokens.bind(model);
    model.countCompletionTokens = async (...args) => {
        const count = await countTokens(...args);
        console.log(JSON.stringify({ actualPromptTokens: count }));
        return count;
    };
    const request = { requestId: 'local-planning-test', messages: [], tools, settings: { stream: true, strigoi_plan_mode: true }, reasoning: { level: process.env.STRIGOI_TEST_REASONING || 'high' } };
    const messages = [{ role: 'system', content: prompt }, { role: 'user', content: user }];
    // Tokenize the real rendered request before spending local inference time.
    const rendered = await fetch(`${endpoint}/apply-template`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(model.createCompletionBody(messages, request, false)) });
    assert.ok(rendered.ok, `apply-template HTTP ${rendered.status}`);
    const renderedBody = await rendered.json();
    const tokenized = await (await fetch(`${endpoint}/tokenize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: renderedBody.prompt }) })).json();
    const promptTokens = tokenized.tokens.length;
    console.log(JSON.stringify({ modelId, reasoning: request.reasoning.level, skillRead: true, documentCharacters: document.length, promptTokens, estimatedTokens: model.estimateTokens(messages), context: slots[0].n_ctx }));
    assert.ok(promptTokens + 512 < slots[0].n_ctx, 'Sources leave insufficient room for output; do not start unsafe inference.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    let output = '';
    let reasoningCharacters = 0;
    try {
        for await (const part of model.runStreamingRequest(endpoint, messages, request, controller)) {
            if (part.content) output += part.content;
            if (part.thought) reasoningCharacters += part.thought.length;
        }
    } finally { clearTimeout(timeout); }
    const checkpoint = completedPlanCheckpoint({ response: { isComplete: true, isError: false, isCanceled: false, response: { content: [{ kind: 'text', asString: () => output }] } } });
    const prepTasks = /(?:^|\n)\s*(?:\d+[.)]|- \[[ x]\])\s*(?:\*\*)?(?:carregar.*skill|load.*skill|ler.*document|read.*document|revisar documenta[cç][aã]o|obtain functional text|collect inputs)/i;
    assert.doesNotMatch(output, prepTasks, 'Preparation appeared in the implementation checklist.');
    assert.match(output, /Radar|Oportunidade/i);
    assert.match(output, /TDB|Technical Design/i);
    assert.match(output, /HTML/i);
    assert.doesNotMatch(output, /Implement a single Apex|Create a Flow|Build an LWC|Grant.*all profiles|implementar.*classe Apex|criar.*Flow\b/i, 'Plan must produce the TDB, not implement the feature or grant permissions.');
    assert.ok(checkpoint, 'No complete deliverable checkpoint returned');
    assert.doesNotMatch(output, /paste.*(?:text|document)|cole.*texto|tools cannot parse/i);
    if (process.env.STRIGOI_TEST_SHOW_PLAN === '1') {
        console.log(output.replace(/<!--\s*strigoi-plan-checkpoint[\s\S]*?-->/i, '').slice(0, 5000));
    }
    console.log(JSON.stringify({ passed: true, visibleCharacters: output.length, reasoningCharacters, toolCalls: calls, completeDeliverableCheckpoint: true, documentAndSkillKeptPrivate: true }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
