const report = JSON.parse(document.getElementById('report-data').textContent);
const $ = id => document.getElementById(id);
let entry = null;
let version = 'merged';
const labels = [0, 1, 2].map(index => `${report.kind === 'file' ? 'Arquivo' : 'Pasta'} 0${(report.slots?.[index] ?? index) + 1}`);
const sideIndex = { base: 0, origin: 1, destination: 2 };
$('sessionInfo').textContent = `${report.entries.length} arquivo(s) com mudança · ${new Date(report.createdAt).toLocaleString('pt-BR')}`;

function renderFiles() {
  const q = $('search').value.toLocaleLowerCase('pt-BR');
  $('files').textContent = '';
  report.entries.filter(item => item.name.toLocaleLowerCase('pt-BR').includes(q)).forEach(item => {
    const button = document.createElement('button');
    button.className = `file${entry?.key === item.key ? ' active' : ''}`;
    const name = document.createElement('strong'); name.textContent = item.name;
    const info = document.createElement('small'); info.textContent = item.error || `${item.format || 'text'} · ${item.status}${item.conflicts ? ` · ${item.conflicts} conflito(s)` : ''}`;
    button.append(name, info); button.onclick = () => select(item); $('files').append(button);
  });
}

function select(item) {
  entry = item;
  version = ['image', 'binary'].includes(item.format) ? ['base', 'origin', 'destination'][item.assetSide ?? 2] : 'merged';
  $('title').textContent = item.name;
  $('subtitle').textContent = item.error || `${item.format || 'text'} · ${item.status} · ${item.conflicts || 0} conflito(s)`;
  $('badge').textContent = item.error ? 'SEM PRÉVIA' : item.review && (!item.review.safe || item.review.modifiedAfterAi) ? 'REVISÃO NECESSÁRIA' : 'PRONTO PARA EXPLORAR';
  renderReview(); renderFiles(); renderButtons(); renderComparison(); renderPreview();
}

function renderReview() {
  const box = $('reviewWarning'); box.textContent = ''; box.classList.remove('visible');
  if (!entry?.review) return;
  const warnings = [...(entry.review.warnings || [])];
  if (entry.review.modifiedAfterAi) warnings.push('O resultado foi alterado após a verificação automática.');
  if (!warnings.length) return;
  const title = document.createElement('strong'); title.textContent = `Atenção · sugestão da IA local (${entry.review.model || 'modelo não informado'})`;
  const message = document.createElement('span'); message.textContent = warnings.join(' ');
  box.append(title, message); box.classList.add('visible');
}

function renderButtons() {
  const host = $('viewButtons'); host.textContent = '';
  if (!entry || entry.error) return;
  const keys = report.roots[0] ? ['base', 'origin', 'destination'] : ['origin', 'destination'];
  if (!['image', 'binary'].includes(entry.format)) keys.push('merged');
  if (typeof entry.aiSuggestion === 'string') keys.push('ai');
  keys.forEach(key => {
    if (['image', 'binary'].includes(entry.format) && !entry.assets?.[sideIndex[key]]) return;
    const button = document.createElement('button'); button.textContent = key === 'merged' ? 'Merge' : key === 'ai' ? 'Sugestão da IA' : labels[sideIndex[key]];
    button.className = version === key ? 'active' : '';
    button.onclick = () => { version = key; renderButtons(); renderPreview(); };
    host.append(button);
  });
}

function dataBytes(uri) {
  const base64 = uri.split(',')[1]; const raw = atob(base64); const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function safePage(html) {
  return '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; object-src \'none\'; base-uri \'none\'">' + html;
}

function renderPreview() {
  const area = $('previewContent'); area.textContent = '';
  if (!entry || entry.error) { $('selectedVersion').textContent = 'Indisponível'; return; }
  const chosen = version === 'merged' ? 'Resultado do merge' : version === 'ai' ? 'Sugestão original da IA' : labels[sideIndex[version]];
  $('selectedVersion').textContent = chosen;
  if (['image', 'binary'].includes(entry.format)) {
    if (entry.format === 'image') {
      const image = document.createElement('img'); image.src = entry.assets[sideIndex[version]]; image.alt = chosen; image.className = 'asset-image'; area.append(image);
    } else {
      const info = document.createElement('div'); info.className = 'asset-info'; info.textContent = `${entry.lengths[sideIndex[version]]} bytes · versão completa incluída neste HTML`; area.append(info);
    }
    return;
  }
  const value = version === 'merged' ? entry.merged : version === 'ai' ? entry.aiSuggestion : entry.texts[sideIndex[version]];
  const textarea = document.createElement('textarea'); textarea.id = 'content'; textarea.readOnly = true; textarea.spellcheck = false; textarea.value = value || '';
  area.append(textarea);
  if (entry.format === 'webpage') {
    const frame = document.createElement('iframe'); frame.className = 'web-frame'; frame.setAttribute('sandbox', ''); frame.srcdoc = safePage(value || '');
    area.prepend(frame);
  }
}

function tableCells(raw, delimiter) {
  const cells = []; let cell = ''; let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') { if (quoted && raw[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { cells.push(cell); cell = ''; }
    else cell += char;
  }
  cells.push(cell); return cells;
}

function addRow(body, number, value, kind, table) {
  const row = document.createElement('div'); row.className = `row ${kind}${value === undefined ? ' blank' : ''}`;
  const no = document.createElement('span'); no.className = 'no'; no.textContent = value === undefined ? '' : number;
  const content = document.createElement('span'); content.className = 'txt';
  if (table && value !== undefined) {
    content.classList.add('cells');
    tableCells(value, entry.delimiter || ',').forEach(value => { const cell = document.createElement('span'); cell.textContent = value || ' '; content.append(cell); });
  } else content.textContent = value === undefined ? ' ' : value || ' ';
  row.append(no, content); body.append(row);
}

function renderComparison() {
  const area = $('comparison'); area.textContent = '';
  if (!entry || entry.error) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = entry?.error || 'Selecione um arquivo.'; area.append(empty); return; }
  const keys = report.roots[0] ? ['base', 'origin', 'destination'] : ['origin', 'destination'];
  const panes = keys.map(key => {
    const pane = document.createElement('div'); pane.className = 'pane';
    const head = document.createElement('div'); head.className = 'pane-head'; head.textContent = labels[sideIndex[key]];
    const body = document.createElement('div'); pane.append(head, body); area.append(pane);
    return { pane, body, key };
  });
  if (entry.format === 'image') {
    panes.forEach(({ body, key }) => {
      if (!entry.assets?.[sideIndex[key]]) return;
      const image = document.createElement('img'); image.className = 'asset-image'; image.src = entry.assets[sideIndex[key]]; image.alt = labels[sideIndex[key]]; body.append(image);
    }); return;
  }
  if (entry.format === 'binary') {
    panes.forEach(({ body, key }) => {
      const index = sideIndex[key];
      let hidden = 0;
      (entry.hexes?.[index] || []).forEach((row, rowIndex) => {
        const equal = keys.every(other => entry.hexes?.[sideIndex[other]]?.[rowIndex]?.hex.join(' ') === row.hex.join(' '));
        if ($('hide').checked && equal) { hidden++; return; }
        const text = `${row.offset.toString(16).padStart(8, '0')}  ${row.hex.join(' ').padEnd(47, ' ')}  ${row.ascii}`;
        addRow(body, rowIndex + 1, text, equal ? 'equal' : 'changed', false);
      });
      if (hidden) { const fold = document.createElement('div'); fold.className = 'fold'; fold.textContent = `⋯ ${hidden} blocos iguais ocultos ⋯`; body.prepend(fold); }
    }); return;
  }
  if (entry.format === 'webpage') {
    panes.forEach(({ body, key }) => {
      if ($('hide').checked) {
        const source = document.createElement('pre'); source.className = 'web-source';
        source.textContent = (entry.segments || []).map(segment => segment.kind === 'equal' ?
          `⋯ ${segment[key]?.length || 0} linhas iguais ocultas ⋯` : (segment[key] || []).join('\n')).join('\n');
        body.append(source);
      } else {
        const frame = document.createElement('iframe'); frame.className = 'web-frame'; frame.setAttribute('sandbox', ''); frame.srcdoc = safePage(entry.texts[sideIndex[key]] || ''); body.append(frame);
      }
    });
    return;
  }
  const counts = Object.fromEntries(keys.map(key => [key, 1]));
  for (const segment of entry.segments || []) {
    if ($('hide').checked && segment.kind === 'equal' && segment.origin?.length) {
      panes.forEach(({ body, key }) => {
        const fold = document.createElement('div'); fold.className = 'fold'; fold.textContent = `⋯ ${segment[key].length} linhas iguais ocultas ⋯`;
        body.append(fold); counts[key] += segment[key].length;
      }); continue;
    }
    const max = Math.max(...keys.map(key => segment[key]?.length || 0));
    for (let row = 0; row < max; row++) panes.forEach(({ body, key }) => {
      const value = segment[key]?.[row]; addRow(body, value === undefined ? '' : counts[key]++, value, segment.kind, entry.format === 'table');
    });
  }
  let syncing = false;
  panes.forEach(({ pane }) => pane.onscroll = () => {
    if (syncing) return; syncing = true;
    panes.forEach(other => { if (other.pane !== pane) { other.pane.scrollTop = pane.scrollTop; other.pane.scrollLeft = pane.scrollLeft; } });
    requestAnimationFrame(() => { syncing = false; });
  });
}

$('download').onclick = () => {
  if (!entry || entry.error) return;
  const asset = ['image', 'binary'].includes(entry.format);
  const bytes = asset ? dataBytes(entry.assets[sideIndex[version]]) : null;
  const value = asset ? bytes : $('content')?.value || '';
  const blob = new Blob([value], { type: asset ? 'application/octet-stream' : 'text/plain;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = entry.name.split('/').pop();
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
$('hide').onchange = renderComparison;
$('search').oninput = renderFiles;
renderFiles(); if (report.entries.length) select(report.entries[0]);
