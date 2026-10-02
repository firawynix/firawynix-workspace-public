/* eslint-disable no-console */
const assert = require('node:assert/strict');
const {
    buildWorkspaceDirectoryListing,
    isWorkspaceRootResource,
    parseWorkspaceListArguments,
    selectWorkspaceListPath
} = require('../strigoi-core/lib/common/workspace-tool-contract');
const {
    LlamaCppLanguageModel,
    canonicalizeToolArguments
} = require('../strigoi-core/lib/node/llama-cpp-language-model');

function sseResponse(chunks) {
    const body = [...chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n'].join('');
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function toolCallChunk(name, args, id = 'call-1') {
    return [
        { choices: [{ delta: { tool_calls: [{ index: 0, id, function: { name, arguments: args } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
    ];
}

function textChunk(text) {
    return [
        { choices: [{ delta: { content: text } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
    ];
}

async function collect(generator) {
    const parts = [];
    for await (const part of generator) parts.push(part);
    return parts;
}

function testRequest(tools) {
    return { requestId: 'smoke', tools, messages: [], settings: { stream: true }, reasoning: { level: 'off' } };
}

function testModel() {
    const model = new LlamaCppLanguageModel('smoke', 'gpt-oss-20b-MXFP4', { status: 'ready' }, () => ({}), {});
    model.countCompletionTokens = async (_endpoint, body) => model.estimateTokens(body.messages);
    return model;
}

async function testWorkspaceRootAndRoundTrip() {
    const projectRoot = 'file:///D:/Work/Project%20Horus';
    assert.equal(isWorkspaceRootResource(projectRoot, [projectRoot]), true);
    assert.equal(isWorkspaceRootResource('file:///D:/Work/Project%20Horus/training', [projectRoot]), false);
    assert.deepEqual(selectWorkspaceListPath(undefined, ['Project Horus']), { type: 'active-root', rootName: 'Project Horus' });
    assert.deepEqual(selectWorkspaceListPath('training', ['Project Horus']), { type: 'path', path: 'training' });
    const root = buildWorkspaceDirectoryListing([
        { workspaceRelativePath: 'Project Horus/training', externalPath: 'file:///D:/Work/Project%20Horus/training', kind: 'directory' },
        { workspaceRelativePath: 'Project Horus/docs', externalPath: 'file:///D:/Work/Project%20Horus/docs', kind: 'directory' },
        { workspaceRelativePath: 'Project Horus/README.md', externalPath: 'file:///D:/Work/Project%20Horus/README.md', kind: 'file' }
    ], ['Project Horus']);
    assert.deepEqual(root, { training: 'directory', docs: 'directory', 'README.md': 'file' });
    const child = buildWorkspaceDirectoryListing([
        { workspaceRelativePath: 'Project Horus/training/README.md', externalPath: 'file:///D:/Work/Project%20Horus/training/README.md', kind: 'file' }
    ], ['Project Horus']);
    assert.deepEqual(child, { 'training/README.md': 'file' });
    assert.match(selectWorkspaceListPath(undefined, ['api', 'web']).error, /Multiple workspace roots/i);
    assert.deepEqual(buildWorkspaceDirectoryListing([
        { workspaceRelativePath: 'api/src', externalPath: 'file:///D:/Work/api/src', kind: 'directory' }
    ], ['api', 'web']), { 'api/src': 'directory' });
}

async function testNestedPathIsRejectedBeforeFilesystem() {
    const result = parseWorkspaceListArguments(JSON.stringify({ path: { path: 'training' } }));
    assert.match(result.error, /expected a string/i);
    assert.deepEqual(parseWorkspaceListArguments('{}'), {});
    assert.match(parseWorkspaceListArguments('{"path":"training","other":true}').error, /only the optional/i);
}

async function testDuplicateFailingCallIsBlocked() {
    let executions = 0;
    const responses = [
        sseResponse(toolCallChunk('getWorkspaceFileList', '{"path":"Project Horus"}')),
        sseResponse(toolCallChunk('getWorkspaceFileList', '{ "path" : "Project Horus" }', 'call-2')),
        sseResponse(textChunk('I will use another path.'))
    ];
    const originalFetch = global.fetch;
    global.fetch = async () => responses.shift();
    try {
        const parts = await collect(testModel().runStreamingRequest('http://local', [], testRequest([{
            id: 'getWorkspaceFileList', name: 'getWorkspaceFileList', parameters: {}, handler: async () => {
                executions++;
                return JSON.stringify({ error: 'Directory not found' });
            }
        }]), new AbortController(), undefined));
        assert.equal(executions, 1);
        assert.ok(parts.some(part => JSON.stringify(part).includes('Repeated tool call blocked')));
        assert.ok(parts.some(part => part.content === 'I will use another path.'));
    } finally {
        global.fetch = originalFetch;
    }
}

async function testToolBudgetEndsInFinalText() {
    let executions = 0;
    const responses = [];
    for (let i = 0; i < 17; i++) responses.push(sseResponse(toolCallChunk('inspect', `{"step":${i}}`, `call-${i}`)));
    responses.push(sseResponse(textChunk('Final response after the tool budget.')));
    const originalFetch = global.fetch;
    const bodies = [];
    global.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return responses.shift(); };
    try {
        const parts = await collect(testModel().runStreamingRequest('http://local', [], testRequest([{
            id: 'inspect', name: 'inspect', parameters: {}, handler: async () => { executions++; return 'ok'; }
        }]), new AbortController(), undefined));
        assert.equal(executions, 16);
        assert.ok(parts.some(part => JSON.stringify(part).includes('Tool budget exhausted')));
        assert.ok(parts.some(part => part.content === 'Final response after the tool budget.'));
        assert.equal(bodies.at(-1).tools, undefined);
    } finally {
        global.fetch = originalFetch;
    }
}

async function testNormalMultiStepFlowAndCanonicalArgs() {
    const calls = [];
    const responses = [
        sseResponse(toolCallChunk('list', '{"path":"."}')),
        sseResponse(toolCallChunk('list', '{"path":"training"}', 'call-2')),
        sseResponse(toolCallChunk('read', '{"path":"training/README.md"}', 'call-3')),
        sseResponse(textChunk('Completed normal multi-step flow.'))
    ];
    const originalFetch = global.fetch;
    global.fetch = async () => responses.shift();
    try {
        const parts = await collect(testModel().runStreamingRequest('http://local', [], testRequest([
            { id: 'list', name: 'list', parameters: {}, handler: async args => { calls.push(args); return 'ok'; } },
            { id: 'read', name: 'read', parameters: {}, handler: async args => { calls.push(args); return 'ok'; } }
        ]), new AbortController(), undefined));
        assert.deepEqual(calls, ['{"path":"."}', '{"path":"training"}', '{"path":"training/README.md"}']);
        assert.ok(parts.some(part => part.content === 'Completed normal multi-step flow.'));
        assert.equal(canonicalizeToolArguments('{ "b": 1, "a": 2 }'), '{"a":2,"b":1}');
    } finally {
        global.fetch = originalFetch;
    }
}

async function testAutomaticContinuation() {
    const originalFetch = global.fetch;
    const bodies = [];
    const responses = [
        sseResponse([{ choices: [{ delta: { content: 'Plano: mapear ' } }] }, { choices: [{ delta: { reasoning_content: 'PRIVATE REASONING' }, finish_reason: 'length' }] }]),
        sseResponse(textChunk('requisitos.'))
    ];
    global.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return responses.shift(); };
    try {
        const parts = await collect(testModel().runStreamingRequest('http://local', [{ role: 'user', content: 'DOCUMENT SOURCE' }], testRequest([]), new AbortController()));
        assert.equal(parts.filter(part => part.content).map(part => part.content).join(''), 'Plano: mapear requisitos.');
        assert.equal(bodies.length, 2);
        assert.match(JSON.stringify(bodies[1].messages), /DOCUMENT SOURCE/);
        assert.doesNotMatch(JSON.stringify(bodies[1].messages), /PRIVATE REASONING/);
        assert.equal(bodies[1].chat_template_kwargs.reasoning_effort, 'low');
        const replayResponses = [sseResponse(toolCallChunk('suggest', '{"path":"x"}')),
            sseResponse([{ choices: [{ delta: { content: 'Partial' }, finish_reason: 'length' }] }]),
            sseResponse(toolCallChunk('suggest', '{ "path": "x" }', 'repeat')), sseResponse(textChunk(' complete'))];
        let suggestions = 0;
        global.fetch = async () => replayResponses.shift();
        await collect(testModel().runStreamingRequest('http://local', [], testRequest([{ id: 'suggest', name: 'suggest', handler: async () => { suggestions++; return 'suggested'; } }]), new AbortController()));
        assert.equal(suggestions, 1, 'Automatic recovery must not replay a completed operation');
        let executions = 0;
        global.fetch = async () => sseResponse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'cut', function: { name: 'write', arguments: '{' } }] }, finish_reason: 'length' }] }]);
        await assert.rejects(collect(testModel().runStreamingRequest('http://local', [], testRequest([{ id: 'write', name: 'write', handler: async () => { executions++; return 'ok'; } }]), new AbortController())), /incompleta/);
        assert.equal(executions, 0);
        let attempts = 0;
        global.fetch = async () => { attempts++; return sseResponse([{ choices: [{ delta: { reasoning_content: 'thinking' }, finish_reason: 'length' }] }]); };
        await assert.rejects(collect(testModel().runStreamingRequest('http://local', [], testRequest([]), new AbortController())), /3 continuações/);
        assert.equal(attempts, 4);
        const controller = new AbortController();
        global.fetch = async () => { controller.abort(); return sseResponse([{ choices: [{ delta: {}, finish_reason: 'length' }] }]); };
        await assert.rejects(collect(testModel().runStreamingRequest('http://local', [], testRequest([]), controller)), /cancelada/);
        global.fetch = async () => sseResponse([{ choices: [{ delta: { content: 'x'.repeat(60000) }, finish_reason: 'length' }] }]);
        await assert.rejects(collect(testModel().runStreamingRequest('http://local', [], testRequest([]), new AbortController())), /espaço de contexto/);
        assert.equal(testModel().createCompletionBody([], { ...testRequest([]), reasoning: { level: 'high' } }, true).chat_template_kwargs.reasoning_effort, 'high');
        assert.match(testModel().toolResultForContext('z'.repeat(2000), [{ role: 'user', content: 'z'.repeat(2000) }]), /already included/);
        const listing = JSON.stringify(Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`directory/file-${index}.cls`, 'file'])));
        const compact = JSON.parse(testModel().toolResultForContext(listing, [], 'getWorkspaceFileList'));
        assert.ok(compact.omittedEntries > 0);
        assert.ok(Object.keys(compact.entries).length > 0);
        assert.match(compact.note, /Partial/);
        const largeRead = JSON.parse(testModel().toolResultForContext('a'.repeat(80000), [], 'getFileContent'));
        assert.equal(largeRead.omittedCharacters, 78400);
        assert.match(largeRead.note, /offset\/limit/);
        assert.match(testModel().toolResultForContext('a'.repeat(80000), [{ role: 'user', content: 'a'.repeat(80000) }], 'getFileContent'), /already included/, 'Complete primary attachment is kept and never converted into an auxiliary preview');
    } finally { global.fetch = originalFetch; }
}

async function testPlanningDiscoveryBudget() {
    const originalFetch = global.fetch;
    const bodies = [];
    const responses = Array.from({ length: 4 }, (_, index) => sseResponse(toolCallChunk('inspect', `{"step":${index}}`, `plan-${index}`)));
    responses.push(sseResponse(textChunk('Deliverable plan.')));
    let executions = 0;
    global.fetch = async (_url, init) => { bodies.push(JSON.parse(init.body)); return responses.shift(); };
    try {
        const request = testRequest([{ id: 'inspect', name: 'inspect', handler: async () => { executions++; return 'actual evidence'; } }]);
        request.settings.strigoi_plan_mode = true;
        const parts = await collect(testModel().runStreamingRequest('http://local', [], request, new AbortController()));
        assert.equal(executions, 4);
        assert.equal(bodies.at(-1).tools, undefined);
        assert.ok(parts.some(part => part.content === 'Deliverable plan.'));
        assert.match(JSON.stringify(bodies.at(-1).messages), /actual evidence/);
    } finally { global.fetch = originalFetch; }
}

(async () => {
    await testWorkspaceRootAndRoundTrip();
    await testNestedPathIsRejectedBeforeFilesystem();
    await testDuplicateFailingCallIsBlocked();
    await testToolBudgetEndsInFinalText();
    await testNormalMultiStepFlowAndCanonicalArgs();
    await testAutomaticContinuation();
    await testPlanningDiscoveryBudget();
    console.log('tool orchestration tests: passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
