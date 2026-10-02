const test = require('node:test');
const assert = require('node:assert/strict');
const { detectFormat, splitTableRows, parseTableRow, hexRows, imageData, fileMatchesMask } = require('../src/formats.cjs');
const { mergeThreeArrays } = require('../src/merge.cjs');

test('reconhece os cinco modos pelo arquivo', () => {
  assert.deepEqual(['a.txt', 'a.csv', 'a.exe', 'a.png', 'a.html'].map(detectFormat),
    ['text', 'table', 'binary', 'image', 'webpage']);
});

test('preserva colunas com aspas, delimitadores e quebras de linha', () => {
  const rows = splitTableRows('id,comentario\r\n1,"primeira, segunda\nlinha"\r\n2,"aspas ""duplas"""');
  assert.equal(rows.length, 3);
  assert.deepEqual(parseTableRow(rows[1]), ['1', 'primeira, segunda\nlinha']);
  assert.deepEqual(parseTableRow(rows[2]), ['2', 'aspas "duplas"']);
  assert.deepEqual(parseTableRow('a\tb\tc', '\t'), ['a', 'b', 'c']);
});

test('merge de tabela identifica conflito no mesmo registro', () => {
  const result = mergeThreeArrays(['id,nome', '1,Ana'], ['id,nome', '1,Ana A'], ['id,nome', '1,Ana B']);
  assert.equal(result.conflicts, 1);
  assert.equal(result.merged, 'id,nome\n1,Ana B');
});

test('prévia binária mantém offsets, bytes e ASCII', () => {
  assert.deepEqual(hexRows(Buffer.from([0x41, 0x00, 0xff])), [{ offset: 0, hex: ['41', '00', 'FF'], ascii: 'A..' }]);
});

test('imagem incluída na revisão como data URI', () => {
  assert.equal(imageData('a.png', Buffer.from([0x89, 0x50])), 'data:image/png;base64,iVA=');
});

test('máscaras de pasta incluem apenas as extensões escolhidas', () => {
  assert.equal(fileMatchesMask('sub/a.csv', '*.txt;*.csv'), true);
  assert.equal(fileMatchesMask('sub/a.bin', '*.txt;*.csv'), false);
  assert.equal(fileMatchesMask('sub/a.csv', 'sub/*.csv'), true);
});
