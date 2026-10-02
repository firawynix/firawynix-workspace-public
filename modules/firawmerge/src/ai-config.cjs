const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const MODELS = [
  { name: 'qwen2.5-coder:0.5b', downloadGb: 0.4, runtimeGb: 0.8 },
  { name: 'qwen2.5-coder:1.5b', downloadGb: 1.0, runtimeGb: 1.7 },
  { name: 'qwen2.5-coder:3b', downloadGb: 1.9, runtimeGb: 3.0 },
  { name: 'qwen2.5-coder:7b', downloadGb: 4.7, runtimeGb: 6.6 },
  { name: 'qwen2.5-coder:14b', downloadGb: 9.0, runtimeGb: 12.5 }
];

async function scanHardware() {
  const result = { cpu: os.cpus()[0]?.model?.trim() || 'CPU não identificada', threads: os.cpus().length,
    ramGb: Math.round(os.totalmem() / 1073741824), gpu: 'Não identificada', vramGb: 0, vramReliable: false };
  if (process.platform !== 'win32') return result;
  const temporary = path.join(os.tmpdir(), `firawmerge-dxdiag-${crypto.randomUUID()}.txt`);
  try {
    await run(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'dxdiag.exe'), ['/whql:off', '/t', temporary], { timeout: 70000, windowsHide: true });
    const text = await fs.readFile(temporary, 'utf8');
    let currentGpu = null;
    const adapters = [];
    for (const line of text.split(/\r?\n/)) {
      const name = line.match(/Card name:\s*(.+)/i);
      if (name) currentGpu = name[1].trim();
      const memory = line.match(/Dedicated Memory:\s*(\d+)\s*MB/i);
      if (memory && currentGpu) adapters.push({ name: currentGpu, memoryMb: Number(memory[1]) });
    }
    adapters.sort((a, b) => b.memoryMb - a.memoryMb);
    if (adapters.length) {
      result.gpu = adapters[0].name;
      result.vramGb = Math.round(adapters[0].memoryMb / 1024);
      result.vramReliable = true;
    } else result.gpu = text.match(/Card name:\s*(.+)/i)?.[1]?.trim() || result.gpu;
  } catch { /* O painel permanece utilizável se o diagnóstico do Windows falhar. */ }
  finally { await fs.unlink(temporary).catch(() => {}); }
  return result;
}

function recommend(settings) {
  const ramGb = Number(settings.ramGb);
  const vramGb = settings.useGpu ? Number(settings.vramGb) : 0;
  const threads = settings.useCpu ? Number(settings.threads) : 0;
  if (!Number.isFinite(ramGb) || ramGb < 2) throw new Error('Reserve pelo menos 2 GB de RAM.');
  if (!settings.useGpu && !settings.useCpu) throw new Error('Habilite CPU ou GPU.');
  if (settings.useGpu && vramGb < 2 && !settings.useCpu) throw new Error('Reserve ao menos 2 GB de VRAM ou habilite a CPU.');
  let viable = MODELS.filter(model => model.runtimeGb + 1 <= ramGb);
  if (settings.useGpu && vramGb >= 2) viable = viable.filter(model => model.runtimeGb <= vramGb * 0.86);
  else if (threads < 8) viable = viable.filter(model => model.runtimeGb <= 3);
  else viable = viable.filter(model => model.runtimeGb <= 6.6);
  const model = viable.at(-1) || MODELS[0];
  const mode = settings.useGpu && vramGb >= model.runtimeGb / 0.86 ? 'GPU, se compatível com o Ollama' : 'CPU';
  return { ...model, mode, note: `Estimativa para ${ramGb} GB de RAM reservada, ${vramGb} GB de VRAM e ${threads} thread(s). O Ollama decide o uso real da GPU; as barras orientam a escolha, não são limites rígidos do sistema.` };
}

function assessSuggestion({ name, candidate, base, origin, destination, segments, doneReason }) {
  const warnings = [];
  const text = candidate.trim();
  if (doneReason === 'length') warnings.push('O modelo atingiu o limite de geração; o resultado pode estar incompleto.');
  if (!text) warnings.push('A IA retornou um arquivo vazio.');
  if (/^(<<<<<<< |=======\s*$|>>>>>>> )/m.test(candidate)) warnings.push('Marcadores de conflito permaneceram no resultado.');
  const reference = Math.max(origin.length, destination.length);
  if (reference > 100 && candidate.length < reference * 0.45) warnings.push('O resultado parece truncado em relação às versões originais.');
  if (reference > 100 && candidate.length > reference * 4) warnings.push('O resultado ficou muito maior que as versões originais.');
  if (segments.some(segment => segment.kind === 'conflict') && typeof base === 'string' && candidate.trim() === base.trim())
    warnings.push('A sugestão voltou à base e pode ter descartado as duas alterações em conflito.');
  if (/\.json$/i.test(name)) {
    try { JSON.parse(candidate); } catch { warnings.push('O JSON resultante é inválido.'); }
  }
  const common = segments.filter(segment => segment.kind === 'equal').flatMap(segment => segment.origin)
    .filter(line => line.trim().length >= 8);
  if (common.length >= 3) {
    const sampled = common.filter((_, i) => i % Math.max(1, Math.floor(common.length / 30)) === 0).slice(0, 30);
    const missing = sampled.filter(line => !candidate.includes(line));
    if (missing.length > Math.max(1, sampled.length * 0.15)) warnings.push('Trechos sem conflito desapareceram da sugestão da IA.');
  }
  const dangerous = [/\bRemove-Item\b[^\n]*\b-Recurse\b/i, /\brm\s+-rf\b/i, /\bInvoke-Expression\b/i, /\beval\s*\(/i];
  if (dangerous.some(pattern => pattern.test(candidate) && !pattern.test(origin) && !pattern.test(destination)))
    warnings.push('A sugestão introduziu um comando potencialmente destrutivo.');
  if (/\.(ps1|bat|cmd|sh|js|ts|py|exe)$/i.test(name)) warnings.push('Arquivo executável ou de código: revise as mudanças antes de usar.');
  return { safe: warnings.length === 0, warnings };
}

module.exports = { MODELS, scanHardware, recommend, assessSuggestion };
