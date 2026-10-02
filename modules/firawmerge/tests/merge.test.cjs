const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeThree, compareTwo } = require('../src/merge.cjs');

test('junta alterações independentes sem conflito', () => {
  const merged = mergeThree('a\nb\nc\nd', 'a\nB\nc\nd', 'a\nb\nc\nD');
  assert.equal(merged.merged, 'a\nB\nc\nD');
  assert.equal(merged.conflicts, 0);
});

test('marca alterações concorrentes e mantém o destino como prévia', () => {
  const merged = mergeThree('a\nb\nc', 'a\nB1\nc', 'a\nB2\nc');
  assert.equal(merged.conflicts, 1);
  assert.equal(merged.merged, 'a\nB2\nc');
  assert.equal(merged.segments.filter(segment => segment.kind === 'conflict').length, 1);
});

test('aceita a mesma alteração feita nos dois lados', () => {
  const merged = mergeThree('a\nb', 'a\nB', 'a\nB');
  assert.equal(merged.conflicts, 0);
  assert.equal(merged.merged, 'a\nB');
});

test('mantém inserções independentes', () => {
  const merged = mergeThree('a\nb\nc', 'a\nx\nb\nc', 'a\nb\ny\nc');
  assert.equal(merged.conflicts, 0);
  assert.equal(merged.merged, 'a\nx\nb\ny\nc');
});

test('comparação de dois arquivos identifica trechos diferentes', () => {
  const comparison = compareTwo('a\nb\nc', 'a\nB\nc');
  assert.equal(comparison.segments.filter(segment => segment.kind === 'changed').length, 1);
  assert.equal(comparison.merged, 'a\nB\nc');
});
