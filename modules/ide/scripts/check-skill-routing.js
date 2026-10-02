const assert = require('node:assert/strict');
const fs = require('node:fs');
const { StrigoiSkillRouter } = require('../strigoi-core/lib/browser/skill-router');

const router = new StrigoiSkillRouter();
const routed = prompt => router.route(prompt).skills.map(skill => skill.id);

assert.deepEqual(routed('Corrija a classe Apex e otimize a consulta SOQL.'), ['salesforce.apex', 'salesforce.soql']);
assert.deepEqual(routed('Ajuste um OmniScript, DataRaptor e Integration Procedure.'), ['salesforce.industries']);
assert.deepEqual(routed('Crie um Agent Script e rode um agent test do Agentforce DX.'), ['salesforce.agentforce']);
assert.deepEqual(routed('Refatore este componente LWC com @wire.'), ['salesforce.lwc']);
assert.deepEqual(routed('Explique closures em JavaScript.'), []);
assert.deepEqual(routed('Ajuste a estrutura deste arquivo HTML.'), []);
assert.match(
  router.createPromptFragment(router.route('Load the skill jp-tdb using getSkillFileContent')),
  /does not override or invalidate a user-selected prompt, slash skill, or tool/i
);

// The Open VSX model is a browser-side dependency. Validate its wiring from
// source here without loading Lumino's DOM-only runtime in this Node check.
const contributionSource = fs.readFileSync(
  'strigoi-core/src/browser/salesforce-extensions-contribution.ts',
  'utf8'
);
assert.match(contributionSource, /@inject\(VSXExtensionsModel\)/);
assert.match(contributionSource, /extensionsModel\.resolve\(SALESFORCE_EXTENSION_PACK_ID\)/);
assert.match(contributionSource, /recommendations\.push\(extension\)/);
assert.doesNotMatch(contributionSource, /workbench\.extensions\.installExtension/);

console.log('Native skill routing: OK (Apex, SOQL, LWC, Industries, Agentforce, fallback, Open VSX pack)');
