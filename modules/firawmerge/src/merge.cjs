const { diffArrays } = require('diff');

function lines(text) {
  return text.replace(/\r\n|\r/g, '\n').split('\n');
}

function edits(base, changed) {
  const parts = diffArrays(base, changed);
  const result = [];
  let position = 0;
  let current = null;
  const flush = () => {
    if (current) result.push(current);
    current = null;
  };
  for (const part of parts) {
    if (!part.added && !part.removed) {
      flush();
      position += part.value.length;
    } else {
      if (!current) current = { start: position, end: position, insert: [] };
      if (part.removed) {
        current.end += part.value.length;
        position += part.value.length;
      } else {
        current.insert.push(...part.value);
      }
    }
  }
  flush();
  return result;
}

function applyEdits(base, start, end, editList) {
  const output = [];
  let at = start;
  for (const edit of editList) {
    output.push(...base.slice(at, edit.start), ...edit.insert);
    at = edit.end;
  }
  output.push(...base.slice(at, end));
  return output;
}

function same(a, b) {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

function mergeThreeArrays(base, origin, destination) {
  const all = [
    ...edits(base, origin).map(edit => ({ ...edit, side: 'origin' })),
    ...edits(base, destination).map(edit => ({ ...edit, side: 'destination' }))
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  const segments = [];
  const result = [];
  let cursor = 0;
  let index = 0;
  let conflicts = 0;
  while (index < all.length) {
    const group = [all[index++]];
    let start = group[0].start;
    let end = group[0].end;
    while (index < all.length && (all[index].start < end ||
      (all[index].start === end && (start === end || all[index].start === all[index].end)))) {
      group.push(all[index]);
      end = Math.max(end, all[index].end);
      index++;
    }
    if (start > cursor) {
      const common = base.slice(cursor, start);
      segments.push({ kind: 'equal', base: common, origin: common, destination: common });
      result.push(...common);
    }
    const baseChunk = base.slice(start, end);
    const originChunk = applyEdits(base, start, end, group.filter(e => e.side === 'origin'));
    const destinationChunk = applyEdits(base, start, end, group.filter(e => e.side === 'destination'));
    let kind = 'changed';
    let chosen;
    if (same(originChunk, destinationChunk)) chosen = originChunk;
    else if (same(originChunk, baseChunk)) chosen = destinationChunk;
    else if (same(destinationChunk, baseChunk)) chosen = originChunk;
    else {
      kind = 'conflict';
      conflicts++;
      chosen = destinationChunk;
    }
    segments.push({ kind, base: baseChunk, origin: originChunk, destination: destinationChunk, start, end });
    result.push(...chosen);
    cursor = end;
  }
  if (cursor < base.length) {
    const common = base.slice(cursor);
    segments.push({ kind: 'equal', base: common, origin: common, destination: common });
    result.push(...common);
  }
  if (!segments.length) segments.push({ kind: 'equal', base, origin: base, destination: base });
  return { segments, merged: result.join('\n'), conflicts };
}

function compareTwoArrays(origin, destination) {
  const changeList = edits(origin, destination);
  const segments = [];
  let at = 0;
  for (const edit of changeList) {
    if (edit.start > at) {
      const common = origin.slice(at, edit.start);
      segments.push({ kind: 'equal', origin: common, destination: common });
    }
    segments.push({ kind: 'changed', origin: origin.slice(edit.start, edit.end), destination: edit.insert });
    at = edit.end;
  }
  if (at < origin.length) {
    const common = origin.slice(at);
    segments.push({ kind: 'equal', origin: common, destination: common });
  }
  if (!segments.length) segments.push({ kind: 'equal', origin, destination });
  return { segments, merged: destination.join('\n'), conflicts: 0 };
}

function mergeThree(baseText, originText, destinationText) {
  return mergeThreeArrays(lines(baseText), lines(originText), lines(destinationText));
}

function compareTwo(originText, destinationText) {
  return compareTwoArrays(lines(originText), lines(destinationText));
}

module.exports = { mergeThree, compareTwo, mergeThreeArrays, compareTwoArrays, lines };
