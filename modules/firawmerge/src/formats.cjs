const path = require('node:path');

const imageMime = Object.freeze({
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif'
});

function detectFormat(name) {
  const extension = path.extname(name).toLowerCase();
  if (extension === '.csv' || extension === '.tsv') return 'table';
  if (imageMime[extension]) return 'image';
  if (extension === '.html' || extension === '.htm') return 'webpage';
  if (['.bin', '.frx', '.exe', '.dll', '.dat'].includes(extension)) return 'binary';
  return 'text';
}

function delimiterFor(name) {
  return path.extname(name).toLowerCase() === '.tsv' ? '\t' : ',';
}

function splitTableRows(text) {
  const normalized = text.replace(/\r\n|\r/g, '\n');
  const rows = [];
  let quoted = false;
  let start = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (char === '"') {
      if (quoted && normalized[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    }
    if (char === '\n' && !quoted) {
      rows.push(normalized.slice(start, i));
      start = i + 1;
    }
  }
  rows.push(normalized.slice(start));
  return rows;
}

function parseTableRow(raw, delimiter = ',') {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') {
      if (quoted && raw[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      fields.push(value); value = '';
    } else value += char;
  }
  fields.push(value);
  return fields;
}

function hexRows(buffer, limit = 65536) {
  const rows = [];
  const bytes = buffer.subarray(0, limit);
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const slice = bytes.subarray(offset, offset + 16);
    rows.push({ offset, hex: Array.from(slice, byte => byte.toString(16).padStart(2, '0').toUpperCase()),
      ascii: Array.from(slice, byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join('') });
  }
  return rows;
}

function imageData(name, buffer) {
  const mime = imageMime[path.extname(name).toLowerCase()];
  if (!mime) throw new Error('Formato de imagem não suportado pela visualização nativa.');
  if (buffer.length > 8 * 1024 * 1024) throw new Error('Imagem acima de 8 MB; selecione uma imagem menor.');
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function isHttpUrl(value) { return /^https?:\/\//i.test(value); }

function fileMatchesMask(relative, mask = '*') {
  const patterns = String(mask).split(/[;,]/).map(part => part.trim()).filter(Boolean);
  if (!patterns.length) return true;
  return patterns.some(pattern => {
    const normalized = pattern.replace(/\\/g, '/');
    const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    const matcher = new RegExp(`^${escaped}$`, 'i');
    return matcher.test(normalized.includes('/') ? relative.replace(/\\/g, '/') : path.basename(relative));
  });
}

module.exports = { detectFormat, delimiterFor, splitTableRows, parseTableRow, hexRows, imageData, isHttpUrl, fileMatchesMask };
