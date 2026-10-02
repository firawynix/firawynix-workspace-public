const test = require('node:test');
const assert = require('node:assert/strict');
const { recommend, assessSuggestion } = require('../src/ai-config.cjs');

test('escolhe modelo de código que cabe no orçamento de GPU e RAM', () => {
  const result = recommend({ ramGb: 32, vramGb: 16, threads: 16, useGpu: true, useCpu: true });
  assert.equal(result.name, 'qwen2.5-coder:14b');
});

test('reduz a recomendação com pouca VRAM', () => {
  const result = recommend({ ramGb: 8, vramGb: 4, threads: 8, useGpu: true, useCpu: true });
  assert.equal(result.name, 'qwen2.5-coder:3b');
});

test('alerta para resultado truncado e JSON inválido', () => {
  const source = JSON.stringify({ chave: 'um texto suficientemente longo para comparar o conteúdo completo das versões'.repeat(3) });
  const result = assessSuggestion({ name: 'config.json', candidate: '{', origin: source, destination: source, segments: [] });
  assert.equal(result.safe, false);
  assert.ok(result.warnings.some(warning => warning.includes('JSON')));
  assert.ok(result.warnings.some(warning => warning.includes('truncado')));
});

test('alerta se a IA introduzir comando destrutivo', () => {
  const result = assessSuggestion({ name: 'notes.txt', candidate: 'rm -rf /', origin: 'a', destination: 'b', segments: [] });
  assert.equal(result.safe, false);
  assert.ok(result.warnings.some(warning => warning.includes('destrutivo')));
});

test('alerta se a IA descartar ambos os lados de um conflito', () => {
  const result = assessSuggestion({ name: 'sample.txt', base: 'one\ntwo\nthree', candidate: 'one\ntwo\nthree',
    origin: 'one\nTWO-A\nthree', destination: 'one\nTWO-B\nthree', segments: [{ kind: 'conflict', origin: ['TWO-A'], destination: ['TWO-B'] }] });
  assert.equal(result.safe, false);
  assert.ok(result.warnings.some(warning => warning.includes('descartado')));
});

test('alerta quando o modelo para no limite de geração', () => {
  const result = assessSuggestion({ name: 'a.txt', candidate: 'final', origin: 'origem', destination: 'destino',
    segments: [], doneReason: 'length' });
  assert.equal(result.safe, false);
  assert.ok(result.warnings.some(warning => warning.includes('limite')));
});
