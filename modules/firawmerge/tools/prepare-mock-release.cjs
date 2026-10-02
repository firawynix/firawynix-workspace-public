const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const base = pkg.build.publish[0].url;
assert.match(base, /^https:\/\//);
const online = path.join(root, 'release', 'nsis-web');
const certificate = path.join(root, 'shell', 'build', 'FirawMergeContext.cer');
fs.copyFileSync(certificate, path.join(online, 'FirawMergeContext.cer'));
for (const name of [`FirawMerge-${pkg.version}-Setup.exe`, `FirawMerge-${pkg.version}-x64.exe`, `FirawMerge-${pkg.version}-ia32.exe`]) {
  fs.copyFileSync(path.join(root, 'release', name), path.join(online, name));
}
const names = [
  `FirawMerge-${pkg.version}-Online-Setup.exe`,
  `firawmerge-${pkg.version}-x64.nsis.7z`,
  `firawmerge-${pkg.version}-ia32.nsis.7z`,
  'latest.yml',
  'FirawMergeContext.cer',
  `FirawMerge-${pkg.version}-Setup.exe`,
  `FirawMerge-${pkg.version}-x64.exe`,
  `FirawMerge-${pkg.version}-ia32.exe`
];
const files = Object.fromEntries(names.map(name => {
  const content = fs.readFileSync(path.join(online, name));
  return [name, { url: new URL(name, base).href, size: content.length,
    sha256: crypto.createHash('sha256').update(content).digest('hex') }];
}));
const latest = fs.readFileSync(path.join(online, 'latest.yml'), 'utf8');
assert.ok(latest.includes(`version: ${pkg.version}`));
for (const name of names.slice(0, 3)) {
  const digest = crypto.createHash('sha512').update(fs.readFileSync(path.join(online, name))).digest('base64');
  assert.ok(latest.includes(digest), `latest.yml não corresponde a ${name}`);
}
const project = {
  id: 'firawmerge', slug: 'firawmerge', nome: 'FirawMerge',
  subtitulo: 'Compare e resolva mudanças entre ambientes',
  descricao: 'Compare pastas e arquivos, resolva conflitos de duas entradas com IA local e compartilhe revisões interativas em HTML.',
  tipo: 'download', categoria: 'projeto', generos: ['Produtividade', 'Desenvolvimento'], cor: '#22d3ee',
  capa: null, banner: null, icone: null,
  downloadUrl: files[names[0]].url, downloadTamanho: files[names[0]].size,
  downloadSha256: files[names[0]].sha256, versao: pkg.version,
  winSignerThumbprint: '668BEF56480FCA8EB1B0BC3B102A6A9CEC554CC4',
  winChave: 'f66155e3-52ac-59d2-ae5f-78317dd2d848', winExe: 'FirawMerge.exe',
  winCaminhos: ['%ProgramFiles%\\FirawMerge\\FirawMerge.exe', '%LOCALAPPDATA%\\Programs\\FirawMerge\\FirawMerge.exe'],
  winInstalador: 'nsis', instaladoTamanho: null, manifestoUrl: null, winLimpeza: [], linux: null,
  disponivel: true,
  extras: [
    { rotulo: 'Instalador completo (sem internet)', url: files[`FirawMerge-${pkg.version}-Setup.exe`].url },
    { rotulo: 'Portátil x64', url: files[`FirawMerge-${pkg.version}-x64.exe`].url },
    { rotulo: 'Portátil x86', url: files[`FirawMerge-${pkg.version}-ia32.exe`].url },
    { rotulo: 'Certificado público (.cer)', url: files['FirawMergeContext.cer'].url },
    { rotulo: 'Código-fonte no GitHub', url: 'https://github.com/hugomendoncaraizen/firawmerge' }
  ],
  jogarUrl: null, siteUrl: 'https://firawmerge.firawynix.com.br/', destaque: false, ordem: 50
};
const target = path.join(root, 'packaging');
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'firawmerge-center-project.mock.json'), JSON.stringify(project, null, 2) + '\n');
fs.writeFileSync(path.join(target, 'firawmerge-center-project.json'), JSON.stringify(project, null, 2) + '\n');
fs.writeFileSync(path.join(target, 'mock-links.json'), JSON.stringify({ mock: false, base, version: pkg.version, files }, null, 2) + '\n');
fs.writeFileSync(path.join(target, 'release-links.json'), JSON.stringify({ base, version: pkg.version, files }, null, 2) + '\n');
console.log(`Release preparada: ${names.length} arquivos, versão ${pkg.version}. Links ${base}`);
