const assert = require('node:assert/strict');
const { StrigoiChatRequestParser } = require('../strigoi-core/lib/browser/strigoi-chat-request-parser');
const { getPlanModeReadOnlyTools, StrigoiAgent } = require('../strigoi-core/lib/browser/strigoi-agent');
const { appendAttachedFileContexts, clearConsumedFileAttachments } = require('../strigoi-core/lib/browser/strigoi-attached-context');
const { preparePlanningSkills, preparePlanningWorkspace, selectedPlanningSkills, applyPreparedSkillContext, completedPlanCheckpoint } = require('../strigoi-core/lib/browser/strigoi-planning-context');

async function main() {
    const selected = [{ kind: 'var', variableName: 'prompt', variableArg: 'jp-tdb', promptText: 'Load the skill jp-tdb using ~{getSkillFileContent}.' }];
    assert.deepEqual(selectedPlanningSkills(selected), ['jp-tdb']);
    assert.deepEqual(selectedPlanningSkills([{ ...selected[0], variableArg: 'jp-tdb|attached source' }]), ['jp-tdb']);
    let preparations = 0;
    const instructions = await preparePlanningSkills(selected, { getFunction: id => ({
        handler: async args => { assert.equal(id, 'getSkillFileContent'); assert.equal(JSON.parse(args).skillName, 'jp-tdb'); preparations++; return '# Actual skill instructions\nProduce a requirements-grounded TDB.'; }
    }) }, {});
    assert.equal(preparations, 1);
    const orientation = [];
    const preflight = await preparePlanningWorkspace({ getFunction: id => ({ handler: async args => {
        orientation.push([id, args]);
        return id === 'getWorkspaceRoots' ? '{"roots":[{"path":"actual-root"}]}' : '{"force-app":"directory"}';
    } }) }, {});
    assert.deepEqual(orientation.map(call => call[0]), ['getWorkspaceRoots', 'getWorkspaceFileList']);
    assert.match(preflight, /already performed/);
    assert.match(preflight, /paths only/);
    await assert.rejects(preparePlanningWorkspace({ getFunction: () => ({ handler: async () => '{"error":"Workspace unavailable"}' }) }, {}), /Workspace unavailable/);
    const prepared = applyPreparedSkillContext(`${selected[0].promptText}\nDocumento anexado: functional.docx`, instructions);
    assert.doesNotMatch(prepared, /Load the skill/);
    assert.match(prepared, /Actual skill instructions/);
    assert.match(prepared, /Documento anexado/);
    await assert.rejects(preparePlanningSkills(selected, { getFunction: () => ({ handler: async () => '{"error":"Skill not found"}' }) }, {}), /Skill not found/);
    await assert.rejects(preparePlanningSkills(selected, { getFunction: () => undefined }, {}), /não está disponível/);
    let cancelledRead = false;
    await assert.rejects(preparePlanningSkills(selected, { getFunction: () => ({ handler: async () => { cancelledRead = true; return 'bad'; } }) }, { cancellationToken: { isCancellationRequested: true } }), /cancelada/);
    assert.equal(cancelledRead, false);
    const checkpointText = '<!-- strigoi-plan-checkpoint\nversion: 1\nobjective: Generate Radar TDB\nnext: Write requirements matrix\n-->';
    const completed = { response: { isComplete: true, isError: false, isCanceled: false, response: { content: [{ kind: 'text', asString: () => checkpointText }] } } };
    assert.match(completedPlanCheckpoint(completed), /Generate Radar TDB/);
    for (const flag of ['isError', 'isCanceled']) {
        assert.equal(completedPlanCheckpoint({ response: { ...completed.response, [flag]: true } }), undefined);
    }
    assert.equal(completedPlanCheckpoint({ response: { ...completed.response, isComplete: false } }), undefined);
    for (const invalidText of [checkpointText.replace('-->', ''), checkpointText.replace('Generate Radar TDB', 'Load jp-tdb skill into agent memory')]) {
        assert.equal(completedPlanCheckpoint({ response: { ...completed.response, response: { content: [{ kind: 'text', asString: () => invalidText }] } } }), undefined);
    }
    const originalRequest = {
        text: '#prompt:jp-tdb#file:xp-investimentos-poc/docs/US_Funcional.docx',
        displayText: 'selected prompt and file'
    };
    let parsedRequest;
    const parser = new StrigoiChatRequestParser();
    parser.delegate = {
        parseChatRequest: async request => {
            parsedRequest = request;
            return { request };
        }
    };
    await parser.parseChatRequest(originalRequest, 'panel', { variables: [] });
    assert.equal(parsedRequest.text, '#prompt:jp-tdb #file:xp-investimentos-poc/docs/US_Funcional.docx');
    assert.equal(parsedRequest.displayText, originalRequest.displayText);
    assert.equal(originalRequest.text, '#prompt:jp-tdb#file:xp-investimentos-poc/docs/US_Funcional.docx');

    const attachmentText = 'Documento anexado: US_Funcional.docx\n<document>REQUISITO RADAR: consultar oportunidades.</document>';
    const modelMessages = [{ actor: 'user', type: 'text', text: 'US_Funcional.docx' }];
    appendAttachedFileContexts(modelMessages, [{
        message: { parts: [{ promptText: 'US_Funcional.docx' }] },
        context: { variables: [
            { variable: { name: 'file' }, contextValue: attachmentText },
            { variable: { name: 'some-other-context' }, contextValue: 'must not leak into the user message' }
        ] }
    }]);
    assert.equal(modelMessages.length, 1);
    assert.match(modelMessages[0].text, /REQUISITO RADAR/);
    const inlineMessage = [{ actor: 'user', type: 'text', text: 'inline.docx' }];
    const inline = { variable: { name: 'file' }, contextValue: 'INLINE DOCUMENT REQUIREMENT' };
    appendAttachedFileContexts(inlineMessage, [{ message: { parts: [{ promptText: 'inline.docx', resolution: inline }], variables: [inline] }, context: { variables: [] } }]);
    assert.match(inlineMessage[0].text, /INLINE DOCUMENT REQUIREMENT/);
    assert.equal(inlineMessage[0].text.match(/INLINE DOCUMENT REQUIREMENT/g).length, 1);
    const source = { message: { parts: selected, variables: [inline] }, context: { variables: [] }, response: { isComplete: false } };
    const followup = { message: { parts: [{ promptText: 'Prossiga' }], variables: [] }, context: { variables: [] }, response: { isComplete: false } };
    const agent = new StrigoiAgent();
    agent.preferenceService = { get: () => 'plan' };
    agent.preparedSkills.set(followup, instructions);
    agent.preparationSources.set(followup, source);
    const preserved = await agent.getMessages({ getRequests: () => [source, followup] });
    assert.equal(preserved.length, 1);
    assert.match(preserved[0].text, /INLINE DOCUMENT REQUIREMENT/);
    assert.match(preserved[0].text, /Actual skill instructions/);
    assert.match(preserved[0].text, /Prossiga/);
    assert.doesNotMatch(preserved[0].text, /Load the skill/);
    assert.doesNotMatch(modelMessages[0].text, /must not leak/);

    const contextManager = {
        variables: [{ variable: { name: 'file' } }, { variable: { name: 'other-context' } }, { variable: { name: 'file' } }],
        getVariables() { return this.variables; },
        deleteVariables(...indices) { indices.sort((a, b) => b - a).forEach(index => this.variables.splice(index, 1)); }
    };
    clearConsumedFileAttachments(contextManager);
    assert.deepEqual(contextManager.variables.map(variable => variable.variable.name), ['other-context']);

    const availableTools = new Map([
        ['getSkillFileContent', { id: 'getSkillFileContent' }],
        ['getFileContent', { id: 'getFileContent' }],
        ['getWorkspaceFileList', { id: 'getWorkspaceFileList' }],
        ['getWorkspaceDirectoryStructure', { id: 'getWorkspaceDirectoryStructure' }],
        ['getWorkspaceRoots', { id: 'getWorkspaceRoots' }],
        ['searchInWorkspace', { id: 'searchInWorkspace' }],
        ['findFilesByPattern', { id: 'findFilesByPattern' }],
        ['shellExecute', { id: 'shellExecute' }],
        ['writeFileContent', { id: 'writeFileContent' }]
    ]);
    const allowed = getPlanModeReadOnlyTools({ getFunction: id => availableTools.get(id) });
    assert.deepEqual(allowed.map(tool => tool.id), [
        'getSkillFileContent',
        'getWorkspaceRoots',
        'getWorkspaceFileList',
        'getWorkspaceDirectoryStructure',
        'getFileContent',
        'searchInWorkspace',
        'findFilesByPattern'
    ]);
    assert.equal(allowed.some(tool => tool.id === 'shellExecute' || tool.id === 'writeFileContent'), false);

    console.log('Planning skill flow: #prompt/#file normalized; file content sent; consumed file chips cleared; read-only allowlist enforced');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
