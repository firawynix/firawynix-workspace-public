import { Command, CommandContribution, CommandRegistry, DisposableCollection, MAIN_MENU_BAR, MessageService, PreferenceScope, PreferenceService } from '@theia/core';
import { ApplicationShell, CommonCommands, ContextMenuRenderer, FrontendApplicationContribution, QuickInputService } from '@theia/core/lib/browser';
import { DiffUris } from '@theia/core/lib/browser/diff-uris';
import { EditorWidget } from '@theia/editor/lib/browser';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog/file-dialog-service';
import { PerspectiveService } from '@theia/core/lib/browser/perspective-service';
import { ChatService, ChangeSetElement } from '@theia/ai-chat/lib/common';
import { ChatViewWidget } from '@theia/ai-chat-ui/lib/browser/chat-view-widget';
import { AI_CHAT_HOME, AI_CHAT_SHOW_CHATS_COMMAND } from '@theia/ai-chat-ui/lib/browser/chat-view-commands';
import { inject, injectable } from '@theia/core/shared/inversify';
import { OPEN_LOCAL_MODEL_CATALOG, OPEN_STRIGOI_HOME, RECOMMEND_LOCAL_AI_MODEL, STRIGOI_HOME_PERSPECTIVE_ID } from './strigoi-core-contribution';
import { STRIGOI_MODE_PREFERENCE } from './strigoi-preferences';
import { completedPlanCheckpoint, selectedPlanningSkills } from './strigoi-planning-context';
import { FirawMergeService } from '../common/firawmerge-service';
import { uiText } from './workspace-language';

export const OPEN_FIRAWMERGE: Command = { id: 'firawynix.ide.open-firawmerge', label: 'Firawynix Workspace: Abrir no FirawMerge' };
const FIRAWMERGE_EXECUTABLE_PREFERENCE = 'firawynix.firawmerge.executable';

/** Presentation of the existing chat and change-set services; no simulated state. */
@injectable()
export class StrigoiIdeContribution implements FrontendApplicationContribution, CommandContribution {
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(PerspectiveService) protected readonly perspectives: PerspectiveService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(ChatService) protected readonly chats: ChatService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(ContextMenuRenderer) protected readonly menus: ContextMenuRenderer;
    @inject(FirawMergeService) protected readonly firawMerge: FirawMergeService;
    @inject(FileDialogService) protected readonly fileDialogs: FileDialogService;

    protected readonly disposables = new DisposableCollection();
    protected top: HTMLElement | undefined;
    protected header: HTMLElement | undefined;
    protected summary: HTMLElement | undefined;
    protected context: HTMLElement | undefined;
    protected reasoning: HTMLElement | undefined;
    protected review: HTMLElement | undefined;
    protected empty: HTMLElement | undefined;
    protected signature = '';
    protected timer: number | undefined;
    protected reviewedUri: string | undefined;
    protected reviewHost: EditorWidget | undefined;
    protected reviewResize: ResizeObserver | undefined;
    protected reviewBusy = false;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(OPEN_FIRAWMERGE, { execute: () => this.openFirawMerge() });
    }

    protected async openFirawMerge(): Promise<void> {
        try {
            let executable = this.preferences.get<string>(FIRAWMERGE_EXECUTABLE_PREFERENCE, '');
            if (!executable) { executable = await this.firawMerge.findExecutable() ?? ''; }
            if (!executable) {
                const selected = await this.fileDialogs.showOpenDialog({
                    canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
                    openLabel: 'Selecionar FirawMerge.exe', title: 'Localizar o FirawMerge neste computador'
                });
                if (!selected) { return; }
                executable = selected.path.fsPath();
                await this.preferences.set(FIRAWMERGE_EXECUTABLE_PREFERENCE, executable, PreferenceScope.User);
            }
            const active = this.shell.currentWidget;
            const file = active instanceof EditorWidget && active.editor.uri.scheme === 'file'
                ? active.editor.uri.path.fsPath() : undefined;
            await this.firawMerge.launch(executable, file ? [file] : []);
            this.messages.info(file ? uiText('Arquivo ativo enviado ao FirawMerge. Escolha a outra versão para comparar.') : uiText('FirawMerge aberto para comparação local.'));
        } catch (error) {
            this.messages.error(`Não foi possível abrir o FirawMerge: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    onStart(): void {
        this.disposables.push(this.perspectives.onDidChangePerspective(() => this.attach()));
        this.disposables.push(this.shell.onDidAddWidget(() => this.attach()));
        this.disposables.push(this.shell.onDidChangeCurrentWidget(() => this.updateReview(this.chats.getActiveSession()?.model.changeSet.getElements() ?? [])));
        this.disposables.push(this.preferences.onPreferenceChanged(e => {
            if (e.preferenceName === STRIGOI_MODE_PREFERENCE) { this.refresh(); }
        }));
        this.disposables.push(this.chats.onSessionEvent(() => { this.signature = ''; this.refresh(); }));
        // Only reconcile data, never observe our own DOM writes (startup loop regression).
        this.timer = window.setInterval(() => this.refresh(), 1000);
    }

    onDidInitializeLayout(): void { this.attach(); }

    protected button(label: string, icon: string, action: () => void, className = ''): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `strigoi-ide-button ${className}`;
        button.title = label;
        button.setAttribute('aria-label', label);
        if (icon) {
            const glyph = document.createElement('span');
            glyph.className = `codicon codicon-${icon}`;
            glyph.setAttribute('aria-hidden', 'true');
            button.append(glyph);
        }
        if (!className.includes('icon-only')) { button.append(document.createTextNode(label)); }
        button.addEventListener('click', action);
        return button;
    }

    protected execute(id: string): void {
        void this.commands.executeCommand(id).catch(error => this.messages.error(String(error)));
    }

    protected attach(): void {
        for (const [id, label] of [['explorer-view-container', uiText('Explorador')], ['problems', uiText('Problemas')], ['test-output-view', uiText('Testes')], ['outputView', uiText('Saída')]]) {
            const widget = this.shell.getWidgetById(id);
            if (widget && widget.title.label !== label) { widget.title.label = label; }
        }
        const topPanel = document.getElementById('theia-top-panel');
        if (topPanel && !this.top) {
            this.top = document.createElement('div');
            this.top.className = 'strigoi-ide-titlebar';
            const brand = document.createElement('div');
            brand.className = 'strigoi-ide-brand';
            brand.textContent = 'Firawynix Workspace';
            const menu = this.button(uiText('Menu principal'), 'menu', () => {
                const rect = menu.getBoundingClientRect();
                this.menus.render({ menuPath: MAIN_MENU_BAR, anchor: { x: rect.left, y: rect.bottom }, context: this.shell.node });
            }, 'icon-only strigoi-ide-menu');
            brand.append(menu);
            const search = this.button(uiText('Buscar arquivos, comandos e símbolos…'), 'search', () => this.quickInput.open(''), 'strigoi-ide-search');
            const key = document.createElement('kbd');
            key.textContent = 'Ctrl P';
            search.append(key);
            const actions = document.createElement('div');
            actions.className = 'strigoi-ide-title-actions';
            actions.append(
                this.button(uiText('IA recomendada'), 'sparkle', () => this.execute(RECOMMEND_LOCAL_AI_MODEL.id)),
                this.button(uiText('Modelos locais'), 'database', () => this.execute(OPEN_LOCAL_MODEL_CATALOG.id)),
                this.button('FirawMerge', 'git-merge', () => this.execute(OPEN_FIRAWMERGE.id)),
                this.button(uiText('Idioma / Language'), 'globe', () => this.execute(CommonCommands.CONFIGURE_DISPLAY_LANGUAGE.id)),
                this.button('Home', 'home', () => this.execute(OPEN_STRIGOI_HOME.id))
            );
            this.top.append(brand, search, actions);
            topPanel.append(this.top);
        }
        const chat = this.shell.getWidgetById(ChatViewWidget.ID);
        if (chat && !this.header?.isConnected) {
            this.header = document.createElement('div');
            this.header.className = 'strigoi-ide-agent-header';
            const row = document.createElement('div');
            row.className = 'strigoi-ide-agent-title';
            const title = document.createElement('strong');
            title.textContent = '✦  Firawynix Workspace';
            const state = document.createElement('span');
            state.className = 'strigoi-ide-agent-state';
            state.textContent = uiText('Assistente');
            row.append(title, state,
                this.button(uiText('Nova conversa'), 'add', () => this.execute(AI_CHAT_HOME.id), 'icon-only'),
                this.button(uiText('Histórico de conversas'), 'history', () => this.execute(AI_CHAT_SHOW_CHATS_COMMAND.id), 'icon-only'));
            const modes = document.createElement('div');
            modes.className = 'strigoi-ide-modes';
            modes.setAttribute('role', 'group');
            modes.setAttribute('aria-label', uiText('Modo Strigoi'));
            for (const [mode, label] of [['conversation', uiText('Conversa')], ['plan', uiText('Planejar')], ['agent', uiText('Agente')]]) {
                const button = this.button(label, '', () => this.execute(`strigoi.mode.${mode}`));
                button.dataset.mode = mode;
                modes.append(button);
            }
            this.header.append(row, modes);
            chat.node.prepend(this.header);
            this.summary = document.createElement('div');
            this.summary.className = 'strigoi-ide-work-summary';
            this.context = document.createElement('div');
            this.context.className = 'strigoi-ide-context';
            this.reasoning = document.createElement('div');
            this.reasoning.className = 'strigoi-ide-reasoning-slot';
            const input = chat.node.querySelector('.chat-input-widget');
            chat.node.insertBefore(this.summary, input);
            chat.node.insertBefore(this.context, input);
            chat.node.insertBefore(this.reasoning, input);
            chat.title.label = 'Firawynix Workspace';
            this.signature = '';
        }
        if (!this.empty) {
            this.empty = document.createElement('div');
            this.empty.className = 'strigoi-ide-empty';
            const title = document.createElement('h1');
            title.textContent = uiText('Seu próximo projeto começa aqui.');
            const description = document.createElement('p');
            description.textContent = uiText('Abra um arquivo, explore o projeto e crie com o Strigoi.');
            const shortcuts = document.createElement('div');
            shortcuts.append(
                this.button(uiText('Abrir pasta'), 'folder-opened', () => this.execute('workspace:openFolder')),
                this.button(uiText('Buscar arquivo'), 'search', () => this.quickInput.open('')),
                this.button(uiText('Todos os comandos'), 'terminal', () => this.quickInput.open('>'))
            );
            this.empty.append(title, description, shortcuts);
            this.shell.mainPanel.node.append(this.empty);
        }
        this.refresh();
    }

    protected refresh(): void {
        const ide = this.perspectives.getActivePerspectiveId() !== STRIGOI_HOME_PERSPECTIVE_ID;
        const toggle = document.querySelector('.strigoi-thinking-toggle');
        const thinkingHost = ide ? this.reasoning : document.querySelector('.theia-ChatInputOptions-left');
        if (toggle && thinkingHost && toggle.parentElement !== thinkingHost) { thinkingHost.append(toggle); }
        // Use Lumino visibility so hidden chrome releases its layout space.
        const right = this.shell.rightPanelHandler;
        right.tabBar.parent?.setHidden(ide);
        right.toolBar.setHidden(ide && right.tabBar.currentTitle?.owner.id === ChatViewWidget.ID);
        this.empty?.classList.toggle('visible', ide && this.shell.getWidgets('main').length === 0);
        if (!ide || !this.header || !this.summary || !this.context) { return; }
        const mode = this.preferences.get<string>(STRIGOI_MODE_PREFERENCE, 'conversation');
        this.header.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
        });
        const session = this.chats.getActiveSession();
        const model = session?.model;
        const requests = model?.getRequests() ?? [];
        const last = requests[requests.length - 1]?.response;
        const state = last && !last.isComplete && !last.isCanceled && !last.isError ? uiText('Trabalhando…') : uiText('Pronto');
        const stateNode = this.header.querySelector('.strigoi-ide-agent-state');
        if (stateNode && stateNode.textContent !== state) { stateNode.textContent = state; }
        const elements = model?.changeSet.getElements() ?? [];
        const pending = elements.filter(e => e.state !== 'applied');
        const taskStart = requests.reduce((latest, request, index) => selectedPlanningSkills(request.message.parts).length ? index : latest, 0);
        const checkpoint = requests.slice(taskStart).reverse().map(completedPlanCheckpoint).find(Boolean);
        const variables = model?.context.getVariables() ?? [];
        const used = [...requests].reverse().find(r => r.response.tokenUsage)?.response.tokenUsage;
        const signature = JSON.stringify([session?.id, mode, checkpoint, elements.map(e => [e.uri.toString(), e.state, e.additionalInfo]), variables.length, used]);
        if (signature === this.signature) { return; }
        this.signature = signature;
        this.summary.replaceChildren();
        if (checkpoint) {
            const card = document.createElement('section');
            card.className = 'strigoi-ide-plan-card';
            const title = document.createElement('strong');
            title.textContent = uiText('Plano de implementação');
            card.append(title);
            for (const [field, label] of [['objective', uiText('Objetivo')], ['completed', uiText('Concluído')], ['next', uiText('Próximo')]]) {
                const value = checkpoint.match(new RegExp(`^${field}:\\s*(.+)$`, 'mi'))?.[1];
                if (!value || /^(none|unknown)$/i.test(value)) { continue; }
                const line = document.createElement('p');
                line.className = `strigoi-ide-plan-${field}`;
                line.textContent = `${field === 'completed' ? '✓ ' : field === 'next' ? '○ ' : ''}${label}: ${value}`;
                card.append(line);
            }
            this.summary.append(card);
        }
        if (elements.length) {
            const card = document.createElement('section');
            card.className = 'strigoi-ide-changes-card';
            const heading = document.createElement('strong');
            heading.textContent = uiText('Alterações propostas');
            card.append(heading);
            for (const element of elements) {
                const row = this.button(element.name || element.uri.path.base, 'file-code', () => this.openChange(element), 'strigoi-ide-file-row');
                const status = document.createElement('span');
                status.className = 'strigoi-ide-file-state';
                status.textContent = element.state === 'applied' ? uiText('✓ Aplicado') : element.type === 'add' ? uiText('+ Novo') : element.type === 'delete' ? uiText('− Remover') : uiText('Revisar');
                row.append(status);
                card.append(row);
            }
            if (pending.length) {
                card.append(this.button(`Revisar ${pending.length} arquivo${pending.length === 1 ? '' : 's'}`, 'diff', () => this.openChange(pending[0]), 'primary'));
            }
            this.summary.append(card);
        }
        this.summary.hidden = !this.summary.childElementCount;
        this.context.replaceChildren();
        const caption = document.createElement('span');
        caption.textContent = `${variables.length} contexto${variables.length === 1 ? '' : 's'} anexado${variables.length === 1 ? '' : 's'}`;
        const usage = document.createElement('span');
        usage.textContent = used ? `${used.inputTokens.toLocaleString()} tokens · última resposta` : uiText('Contexto sob demanda');
        this.context.append(caption, usage);
        this.updateReview(elements);
    }

    protected openChange(element: ChangeSetElement): void {
        this.reviewedUri = element.uri.toString();
        void element.openChange?.().then(() => this.updateReview(this.chats.getActiveSession()?.model.changeSet.getElements() ?? []))
            .catch(error => this.messages.error(String(error)));
    }

    protected updateReview(elements: ChangeSetElement[]): void {
        const element = elements.find(e => e.uri.toString() === this.reviewedUri);
        const host = element && this.shell.getWidgets('main').find((widget): widget is EditorWidget =>
            widget instanceof EditorWidget && widget.isVisible && DiffUris.isDiffUri(widget.editor.uri)
            && DiffUris.decode(widget.editor.uri).some(uri => uri.path.toString() === element.uri.path.toString()));
        if (this.review && this.reviewHost === host && this.review.dataset.state === (element?.state ?? 'pending') && this.review.dataset.busy === String(this.reviewBusy)) { return; }
        this.reviewResize?.disconnect();
        this.reviewResize = undefined;
        this.review?.remove();
        this.review = undefined;
        this.reviewHost?.node.classList.remove('strigoi-has-review');
        this.reviewHost?.editor.refresh();
        this.reviewHost = undefined;
        if (!element || !host) { return; }
        const bar = document.createElement('div');
        bar.className = 'strigoi-ide-reviewbar';
        bar.dataset.state = element.state ?? 'pending';
        bar.dataset.busy = String(this.reviewBusy);
        const label = document.createElement('span');
        label.textContent = `Revisar alterações · ${element.uri.path.base}`;
        bar.append(label);
        if (element.state === 'applied') {
            bar.append(this.button(uiText('Desfazer'), 'discard', () => this.applyReview(element, true)));
        } else {
            bar.append(this.button(uiText('Rejeitar'), '', () => {
                this.chats.getActiveSession()?.model.changeSet.removeElements(element.uri);
                this.signature = ''; this.refresh();
            }), this.button(uiText('Aceitar arquivo'), 'check', () => this.applyReview(element), 'primary'));
        }
        bar.append(this.button(uiText('Fechar revisão'), 'close', () => {
            this.reviewedUri = undefined; this.updateReview([]);
        }, 'icon-only'));
        bar.querySelectorAll('button').forEach(button => { button.disabled = this.reviewBusy; });
        this.review = bar;
        this.reviewHost = host;
        host.node.classList.add('strigoi-has-review');
        host.node.prepend(bar);
        // Reserve an actual row, including after split resizing. Never cover code.
        const resize = () => requestAnimationFrame(() => {
            if (this.reviewHost === host && host.isVisible) {
                host.editor.setSize({ width: host.node.clientWidth, height: Math.max(0, host.node.clientHeight - 42) });
            }
        });
        this.reviewResize = new ResizeObserver(resize);
        this.reviewResize.observe(host.node);
        resize();
    }

    protected async applyReview(element: ChangeSetElement, revert = false): Promise<void> {
        if (this.reviewBusy) { return; }
        this.reviewBusy = true;
        this.updateReview(this.chats.getActiveSession()?.model.changeSet.getElements() ?? []);
        try {
            await (revert ? element.revert?.() : element.apply?.());
        } catch (error) {
            void this.messages.error(String(error));
        } finally {
            this.reviewBusy = false;
            this.signature = ''; this.refresh();
        }
    }

    onStop(): void {
        this.disposables.dispose();
        this.reviewResize?.disconnect();
        if (this.timer !== undefined) { clearInterval(this.timer); }
        for (const element of [this.top, this.header, this.summary, this.context, this.reasoning, this.review, this.empty]) { element?.remove(); }
    }
}
