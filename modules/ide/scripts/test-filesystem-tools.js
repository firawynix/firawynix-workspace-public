/* Tests the production tool handler with real filesystem reads, not mocked document text. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const URI = require('@theia/core/lib/common/uri').default;
const { resolveStrigoiPath, readStrigoiFileTool } = require('../strigoi-core/lib/common/filesystem-tool-engine');
const { extractStrigoiDocumentText, formatStrigoiDocumentContext } = require('../strigoi-core/lib/browser/strigoi-document-content');

async function main() {
    const workspacePath = process.env.STRIGOI_TEST_WORKSPACE;
    const documentPath = process.env.STRIGOI_TEST_DOCUMENT;
    const externalDocument = process.env.STRIGOI_TEST_EXTERNAL_DOCUMENT;
    const home = URI.fromFilePath(os.homedir());
    const roots = workspacePath ? [URI.fromFilePath(workspacePath)] : [URI.fromFilePath(process.cwd())];
    const config = home.resolve('.strigoi');
    const sourceReads = [];
    const services = {
        resolve: async file => resolveStrigoiPath(file, roots, home),
        ensureAccessible: async uri => {
            if (!roots.some(root => root.isEqualOrParent(uri, process.platform !== 'win32'))) {
                throw new Error('Outside workspace: attach this exact file or configure allowedExternalPaths.');
            }
        },
        skillRoots: async () => [home.resolve('.agents/skills'), config.resolve('skills')],
        readBytes: async uri => new Uint8Array(await fs.readFile(uri.path.fsPath())),
        readSource: async args => {
            const parsed = JSON.parse(args);
            sourceReads.push(parsed.file);
            return fs.readFile(new URI(parsed.file).path.fsPath(), 'utf8');
        }
    };
    const read = async (file, attachments, context) => readStrigoiFileTool(JSON.stringify({ file }), services, context, attachments);
    const encodedRoot = new URI('file:///d%3A/Work/XP%20Investimentos/xp-poc-workspace/xp-investimentos-poc');
    const winFile = 'D:\\Work\\XP Investimentos\\xp-poc-workspace\\xp-investimentos-poc\\docs\\requirements.docx';
    assert.equal(resolveStrigoiPath(winFile, [encodedRoot], home).scheme, 'file');
    assert.ok(encodedRoot.isEqualOrParent(resolveStrigoiPath(winFile, [encodedRoot], home), false));
    assert.equal(new URI(winFile).scheme.toLowerCase(), 'd', 'Reproduce old Windows attachment scheme defect');
    for (const form of ['docs/requirements.docx', 'xp-investimentos-poc/docs/requirements.docx', './docs/requirements.docx']) {
        assert.equal(resolveStrigoiPath(form, [encodedRoot], home).toString(), encodedRoot.resolve('docs/requirements.docx').toString());
    }
    assert.equal(resolveStrigoiPath('file:///d%3A/Work/XP%20Investimentos/a.docx', [], home).path.base, 'a.docx');
    assert.equal(resolveStrigoiPath('~/.agents/skills/jp-tdb/SKILL.md', [], home).toString(), home.resolve('.agents/skills/jp-tdb/SKILL.md').toString());
    assert.equal(resolveStrigoiPath('/tmp/test.txt', [], home).scheme, 'file');
    assert.equal(resolveStrigoiPath('\\\\server\\share\\test.txt', [], home).authority, 'server');
    assert.throws(() => resolveStrigoiPath('docs/file.txt', [encodedRoot, home], home), /Ambiguous/);
    assert.throws(() => resolveStrigoiPath('http://example.com/file.txt', roots, home), /Unsupported/);
    assert.throws(() => resolveStrigoiPath('C:relative.txt', roots, home), /Unsupported/);
    assert.throws(() => resolveStrigoiPath('', roots, home), /non-empty/);
    const switched = [home.resolve('other-workspace')];
    assert.equal(resolveStrigoiPath('docs/file.txt', switched, home).toString(), switched[0].resolve('docs/file.txt').toString());
    const invalid = await readStrigoiFileTool('{"file":{"path":"README.md"}}', services);
    assert.match(JSON.parse(invalid).error, /requires/);
    assert.match(JSON.parse(await read('README.md', [], { cancellationToken: { isCancellationRequested: true } })).error, /cancelled/);
    const missing = JSON.parse(await read('docs/definitely-does-not-exist.docx'));
    assert.ok(missing.error);
    assert.ok(missing.resolvedUri.endsWith('/docs/definitely-does-not-exist.docx'));
    assert.equal(sourceReads.length, 0, 'Missing DOCX must never trigger README/source fallback');
    const outside = home.resolve('not-attached.txt');
    assert.match(JSON.parse(await read(outside.toString())).error, /Outside workspace/);
    // Only the explicit current attachment reference permits this external read.
    const attached = [{ variable: { name: 'file' }, arg: 'strigoi-drop-1', value: 'document.txt', contextValue: 'EXACT ATTACHED DOCUMENT' }];
    assert.equal(await read('strigoi-drop-1', attached), 'EXACT ATTACHED DOCUMENT');
    assert.ok(JSON.parse(await read('strigoi-drop-1', [])).error);
    assert.match(JSON.parse(await read('document.txt', [...attached, ...attached])).error, /Ambiguous/);

    if (documentPath) {
        const filename = path.basename(documentPath);
        let referenceText;
        for (const form of [`docs/${filename}`, `${roots[0].path.base}/docs/${filename}`, documentPath, URI.fromFilePath(documentPath).toString()]) {
            const text = await read(form);
            assert.equal(typeof text, 'string');
            assert.ok(text.length > 10000, `Document not extracted for ${form}`);
            assert.ok(!text.startsWith('PK'), 'DOCX must be extracted text, not raw ZIP bytes');
            if (referenceText) { assert.equal(text, referenceText); }
            referenceText = text;
        }
        console.log(`PASS: actual workspace DOCX extracted identically through 4 path forms (${referenceText.length} characters; private content omitted).`);
    }
    const skillPath = home.resolve('.agents/skills/jp-tdb/SKILL.md');
    if (await fs.stat(skillPath.path.fsPath()).catch(() => undefined)) {
        const skill = await read(skillPath.toString());
        assert.match(skill, /jp-tdb/);
        assert.equal(skill, await read('~/.agents/skills/jp-tdb/SKILL.md'));
        console.log('PASS: actual personal skill read outside workspace with dynamic home directory.');
    }
    if (externalDocument) {
        const uri = URI.fromFilePath(externalDocument);
        assert.match(JSON.parse(await read(uri.toString())).error, /Outside workspace/);
        const text = await extractStrigoiDocumentText(await fs.readFile(externalDocument), uri.path.base);
        const contexts = [{ variable: { name: 'file' }, arg: externalDocument, value: uri.toString(), contextValue: formatStrigoiDocumentContext(uri.path.base, text) }];
        assert.equal(await read(externalDocument, contexts), contexts[0].contextValue);
        assert.equal(await read(uri.toString(), contexts), contexts[0].contextValue);
        console.log(`PASS: actual external DOCX available only in the request containing its attachment (${text.length} characters).`);
    }
    const sourceFile = documentPath ? 'README.md' : 'package.json';
    assert.ok((await read(sourceFile)).length > 0);
    assert.ok(sourceReads[sourceReads.length - 1].endsWith(`/${sourceFile}`), 'Normal sources must delegate to upstream editor/tracker reader');
    console.log('PASS: path normalization, changed workspace, ambiguity, cancellation, errors, source delegation and external access boundary.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
