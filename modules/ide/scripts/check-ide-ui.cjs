/* Integration test for the local preview; run with the isolated QA workspace/backend. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer');

const root = path.resolve(__dirname, '..');
const qa = path.join(root, 'design/qa/ide-astra');
const workspace = path.join(qa, 'workspace');
const artifactDir = path.join(qa, 'results');
const checks = [];
const check = (name, result) => { assert.ok(result, name); checks.push(name); console.log('PASS', name); };

(async () => {
    fs.mkdirSync(artifactDir, { recursive: true });
    const browser = process.env.STRIGOI_QA_CDP ? await puppeteer.connect({
        browserWSEndpoint: process.env.STRIGOI_QA_CDP, defaultViewport: { width: 1672, height: 941, deviceScaleFactor: 1 }
    }) : await puppeteer.launch({
        executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        headless: true,
        args: ['--no-sandbox'],
        defaultViewport: { width: 1672, height: 941, deviceScaleFactor: 1 }
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
        await page.goto(process.env.STRIGOI_QA_URL || 'http://127.0.0.1:3101');
        await page.waitForSelector('.strigoi-home-ide-action', { timeout: 60000 });
        await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.includes('Yes, I trust'))?.click());
        await page.evaluate(() => {
            const c = window.theia.container;
            window.qaGet = name => c.get([...c._bindingDictionary._map.keys()].find(k => (typeof k === 'function' ? k.name : String(k)) === name));
        });
        check('Isolated QA workspace', await page.evaluate(async () => (await window.qaGet('WorkspaceService').roots)[0].resource.path.toString().endsWith('/design/qa/ide-astra/workspace')));
        await page.evaluate(async () => {
            const pref = window.qaGet('Symbol(PreferenceService)');
            await pref.set('strigoi.agent.subagent.autoDownload', false, 1);
            await pref.set('ai-features.AiEnable.enableAI', true, 1);
            await pref.set('ai-features.chat.defaultChatAgent', 'Strigoi', 1);
            await window.qaGet('CommandRegistry').executeCommand('strigoi.ide.open');
            const root = (await window.qaGet('WorkspaceService').roots)[0].resource;
            window.qaUri = root.resolve('src/utils/email.ts');
            await window.qaGet('EditorManager').open(window.qaUri);
        });
        await page.waitForFunction(() => document.querySelector('.strigoi-ide-shell') && document.querySelector('.monaco-editor'));
        check('TypeScript grammar', await page.evaluate(() => window.qaGet('EditorManager').all.find(w => w.editor.uri.path.base === 'email.ts').editor.document.languageId === 'typescript'));
        await page.click('.strigoi-ide-menu');
        try {
            await page.waitForSelector('.lm-Menu', { visible: true, timeout: 2000 });
        } catch {
            // The initial editor focus restoration can dismiss an immediately opened menu.
            await page.click('.strigoi-ide-menu');
        }
        await page.waitForFunction(() => [...document.querySelectorAll('.lm-Menu-itemLabel')].some(e => e.textContent === 'Terminal' && e.getBoundingClientRect().width > 0));
        check('Complete main menu', await page.evaluate(() => [...document.querySelectorAll('.lm-Menu-itemLabel')].some(e => e.textContent === 'Terminal' && e.getBoundingClientRect().width > 0)));
        await page.keyboard.press('Escape');
        await page.click('.strigoi-ide-title-actions [aria-label="Modelos locais"]');
        await page.waitForSelector('.strigoi-model-catalog-modal');
        check('Model catalogue opens from IDE', true);
        await page.click('.strigoi-model-catalog-close');
        for (const mode of ['conversation', 'plan', 'agent']) {
            await page.click(`.strigoi-ide-modes [data-mode="${mode}"]`);
            try {
                await page.waitForFunction(m => document.querySelector(`.strigoi-ide-modes [data-mode="${m}"]`)?.getAttribute('aria-pressed') === 'true', { timeout: 2000 }, mode);
            } catch {
                await page.click(`.strigoi-ide-modes [data-mode="${mode}"]`);
            }
            await page.waitForFunction(m => document.querySelector(`.strigoi-ide-modes [data-mode="${m}"]`)?.getAttribute('aria-pressed') === 'true', {}, mode);
            check(`Mode ${mode}`, true);
        }
        // A deterministic response fixture exercises native rendering without running an LLM.
        await page.evaluate(async () => {
            const get = window.qaGet;
            const session = get('Symbol(ChatService)').createSession();
            window.qaSession = session;
            await get('Symbol(ChatService)').renameSession(session.id, 'QA · revisão de e-mail');
            const parsed = await get('Symbol(ChatRequestParser)').parseChatRequest({ text: 'Valide e-mails e adicione testes unitários.' }, 'panel', { variables: [] });
            const request = session.model.addRequest(parsed, 'Strigoi');
            const value = 'Preparei a validação e os testes. Revise as alterações antes de aplicar.\n\n<!-- strigoi-plan-checkpoint\nobjective: Validar endereços de e-mail\ncompleted: Analisar o utilitário e preparar as alterações\nnext: Aplicar e executar os testes\n-->';
            request.response.response.addContent({ kind: 'markdownContent', content: { value }, asString: () => value, asDisplayString: () => value,
                toLanguageModelMessage: () => ({ actor: 'ai', type: 'text', text: value }), toSerializable: () => ({ kind: 'markdownContent', data: { content: value } }) });
            request.response.complete();
            const original = await get('ChangeSetFileService').read(window.qaUri);
            window.qaOriginal = original;
            window.qaRequest = request;
            const element = get('Symbol(ChangeSetFileElementFactory)')({ uri: window.qaUri, chatSessionId: session.id, requestId: request.id, state: 'pending', type: 'modify',
                targetState: original.replace("return email.includes('@');", "return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email);") });
            await element.ensureInitialized();
            session.model.changeSet.addElements(element);
            window.qaChange = element;
        });
        await page.waitForSelector('.strigoi-ide-file-row');
        check('Plan checkpoint rendered', await page.evaluate(() => document.querySelector('.strigoi-ide-plan-card')?.textContent.includes('Aplicar e executar')));
        await page.click('.strigoi-ide-file-row');
        await page.waitForSelector('[aria-label="Aceitar arquivo"]');
        check('Review reserves a real row above code', await page.evaluate(() => {
            const bar = document.querySelector('.strigoi-ide-reviewbar');
            const editor = bar.parentElement.querySelector('.monaco-diff-editor');
            return editor.getBoundingClientRect().top >= bar.getBoundingClientRect().bottom - 1;
        }));
        await page.screenshot({ path: path.join(artifactDir, 'ide-review-1672.png') });
        await page.click('[aria-label="Aceitar arquivo"]');
        await page.waitForFunction(() => window.qaChange.state === 'applied');
        const output = execFileSync(process.execPath, ['--experimental-strip-types', '--test', 'src/utils/email.test.mjs'], { cwd: workspace, encoding: 'utf8' });
        check('Accepted change passes all 6 fixture tests', /pass 6/.test(output));
        await page.click('.strigoi-ide-file-row');
        await page.waitForSelector('[aria-label="Desfazer"]');
        await page.click('[aria-label="Desfazer"]');
        await page.waitForFunction(() => window.qaChange.state === 'pending');
        await page.waitForFunction(async () => (await window.qaGet('ChangeSetFileService').read(window.qaUri)) === window.qaOriginal);
        const originalBytes = await page.evaluate(() => window.qaOriginal);
        // Native editor undo changes the document before its asynchronous save reaches disk.
        for (let attempt = 0; attempt < 50 && fs.readFileSync(path.join(workspace, 'src/utils/email.ts'), 'utf8') !== originalBytes; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        check('Undo restores original bytes', fs.readFileSync(path.join(workspace, 'src/utils/email.ts'), 'utf8') === originalBytes);
        await page.waitForSelector('[aria-label="Rejeitar"]');
        await page.click('[aria-label="Rejeitar"]');
        await page.waitForFunction(() => window.qaGet('Symbol(ChatService)').getActiveSession().model.changeSet.getElements().length === 0);
        check('Reject removes proposal without changing file', fs.readFileSync(path.join(workspace, 'src/utils/email.ts'), 'utf8') === await page.evaluate(() => window.qaOriginal));
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => window.qaGet('CommandRegistry').executeCommand('strigoi.home.open'));
            await page.waitForFunction(() => document.querySelector('.strigoi-home-shell'));
            await page.evaluate(() => window.qaGet('CommandRegistry').executeCommand('strigoi.ide.open'));
            await page.waitForFunction(() => document.querySelector('.strigoi-ide-shell'));
        }
        check('Home/IDE preserve conversation and editor', await page.evaluate(() => window.qaGet('Symbol(ChatService)').getActiveSession().id === window.qaSession.id && window.qaGet('EditorManager').all.some(w => w.editor.uri.path.base === 'email.ts')));
        for (const size of [{ width: 1672, height: 941 }, { width: 1280, height: 800 }]) {
            await page.setViewport(size);
            await page.waitForFunction(() => {
                const r = document.querySelector('.strigoi-ide-titlebar').getBoundingClientRect();
                return r.width <= window.innerWidth;
            });
            check(`No overlap at ${size.width}×${size.height}`, await page.evaluate(() => {
                const rail = document.querySelector('#theia-left-content-panel > .theia-app-sidebar-container').getBoundingClientRect();
                const left = document.querySelector('#theia-left-side-panel').getBoundingClientRect();
                const chat = document.querySelector('.chat-view-widget').getBoundingClientRect();
                const input = document.querySelector('.chat-input-widget').getBoundingClientRect();
                return left.left >= rail.right - 1 && chat.right <= innerWidth + 1 && input.bottom <= document.querySelector('#theia-statusBar').getBoundingClientRect().top + 1;
            }));
            await page.screenshot({ path: path.join(artifactDir, `ide-${size.width}.png`) });
        }
        check('No uncaught renderer errors', errors.length === 0);
        fs.writeFileSync(path.join(artifactDir, 'checks.json'), JSON.stringify({ checks, errors, fixtureTests: output, time: new Date().toISOString() }, null, 2));
    } finally {
        await page.close();
        if (process.env.STRIGOI_QA_CDP) { browser.disconnect(); } else { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
