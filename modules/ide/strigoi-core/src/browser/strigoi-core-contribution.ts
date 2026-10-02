import { Command, CommandContribution, CommandRegistry, Disposable, MessageService, PreferenceScope, PreferenceService } from '@theia/core';
import { AISettingsService, PromptService, ReasoningLevel } from '@theia/ai-core';
import { ChatService } from '@theia/ai-chat/lib/common';
import { ApplicationShell, FrontendApplication, FrontendApplicationContribution, QuickInputService, QuickPickItem, StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog/file-dialog-service';
import { PerspectiveContribution, PerspectiveService } from '@theia/core/lib/browser/perspective-service';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { ChatViewWidget } from '@theia/ai-chat-ui/lib/browser/chat-view-widget';
import { inject, injectable } from '@theia/core/shared/inversify';
import { LocalRuntimeConfiguration, LocalRuntimeService } from '../common/local-runtime-service';
import { LocalModelCatalogEntry, LocalModelCatalogService } from '../common/local-model-catalog-service';
import { recommendLocalModel } from '../common/local-model-recommendation';
import { STRIGOI_AGENT_ID, STRIGOI_AGENT_MODE_ID, STRIGOI_CONVERSATION_MODE_ID, STRIGOI_PLAN_MODE_ID, STRIGOI_SYSTEM_PROMPT_ID } from './strigoi-agent';
import { StrigoiHomeSessionsWidget } from './strigoi-home-sessions-widget';
import {
    STRIGOI_AGENT_ENABLED_PREFERENCE,
    STRIGOI_AGENT_MIGRATED_PREFERENCE,
    STRIGOI_AGENT_SUBAGENT_AUTO_DOWNLOAD_PREFERENCE,
    STRIGOI_AGENT_SUBAGENT_MODEL_PREFERENCE,
    STRIGOI_AGENT_SUBAGENT_PATH_PREFERENCE,
    STRIGOI_COMPANION_ENABLED_PREFERENCE,
    STRIGOI_LLAMA_CPP_MODEL_PATH_PREFERENCE,
    STRIGOI_LLAMA_CPP_SERVER_PATH_PREFERENCE,
    STRIGOI_LOCAL_MODELS_DIRECTORY_PREFERENCE,
    STRIGOI_LOCAL_RUNTIME_MIGRATED_PREFERENCE,
    STRIGOI_LOCAL_RUNTIME_MODEL_PREFERENCE,
    STRIGOI_LOCAL_RUNTIME_PREFERENCE,
    STRIGOI_MODE_MIGRATED_PREFERENCE,
    STRIGOI_MODE_PREFERENCE,
    STRIGOI_WEB_SEARCH_MODE_PREFERENCE
} from './strigoi-preferences';

export const OPEN_STRIGOI_IDE: Command = {
    id: 'strigoi.ide.open',
    label: 'Firawynix Workspace: Abrir IDE'
};

export const OPEN_STRIGOI_HOME: Command = {
    id: 'strigoi.home.open',
    label: 'Firawynix Workspace: Voltar para Home'
};

export const STRIGOI_HOME_PERSPECTIVE_ID = 'strigoi-home';
export const STRIGOI_IDE_PERSPECTIVE_ID = 'strigoi-ide-astra';

export const SHOW_LOCAL_AI_STATUS: Command = {
    id: 'strigoi.local-ai.status',
    label: 'Firawynix Workspace: Atualizar status da IA local'
};

export const TOGGLE_STRIGOI_AGENT: Command = {
    id: 'strigoi.agent.toggle',
    label: 'Firawynix Workspace: Alternar modo'
};

export const SET_STRIGOI_PLAN_MODE: Command = {
    id: 'strigoi.mode.plan',
    label: 'Firawynix Workspace: Ativar Modo Planejamento'
};

export const SET_STRIGOI_CONVERSATION_MODE: Command = {
    id: 'strigoi.mode.conversation',
    label: 'Firawynix Workspace: Ativar Modo Conversa'
};

export const SET_STRIGOI_AGENT_MODE: Command = {
    id: 'strigoi.mode.agent',
    label: 'Firawynix Workspace: Ativar Modo Agente'
};

export const SELECT_LOCAL_AI_MODEL: Command = {
    id: 'strigoi.local-ai.select-model',
    label: 'Firawynix Workspace: Selecionar modelo local'
};

export const RELEASE_LOCAL_AI_MEMORY: Command = {
    id: 'strigoi.local-ai.release-memory',
    label: 'Firawynix Workspace: Liberar memória da IA local'
};

export const SHOW_LOCAL_AI_ONBOARDING: Command = {
    id: 'strigoi.local-ai.onboarding',
    label: 'Firawynix Workspace: Orientar configuração da IA local'
};

export const SHOW_LOCAL_AI_TELEMETRY: Command = {
    id: 'strigoi.local-ai.telemetry',
    label: 'Firawynix Workspace: Exibir telemetria da IA local'
};

export const DOWNLOAD_VERIFIED_LOCAL_MODEL: Command = {
    id: 'strigoi.local-ai.download-verified-model',
    label: 'Firawynix Workspace: Baixar modelo local verificado'
};

export const OPEN_LOCAL_MODEL_CATALOG: Command = {
    id: 'strigoi.local-ai.catalog',
    label: 'Firawynix Workspace: Explorar modelos locais'
};

export const RECOMMEND_LOCAL_AI_MODEL: Command = {
    id: 'strigoi.local-ai.recommend',
    label: 'Firawynix Workspace: Recomendar e instalar IA local'
};

export const TOGGLE_STRIGOI_WEB_SEARCH: Command = {
    id: 'strigoi.web-search.toggle',
    label: 'Firawynix Workspace: Alternar pesquisa web'
};

interface LocalModelQuickPickItem extends QuickPickItem {
    model: string;
    filePath?: string;
}

interface CatalogModelQuickPickItem extends QuickPickItem {
    entry: LocalModelCatalogEntry;
}

interface LocalAiTelemetry {
    model?: string;
    inputTokens: number;
    outputTokens: number;
    tokensPerSecond?: number;
}

type StrigoiMode = 'conversation' | 'plan' | 'agent';

@injectable()
export class StrigoiCoreContribution implements CommandContribution, FrontendApplicationContribution, TabBarToolbarContribution, PerspectiveContribution {

    protected static readonly EMPTY_EDITOR_CLASS = 'strigoi-empty-editor';
    protected static readonly LOCAL_AI_STATUS_BAR_ID = 'strigoi-local-ai-status';
    protected static readonly AGENT_STATUS_BAR_ID = 'strigoi-agent-status';
    protected static readonly RELEASE_MEMORY_STATUS_BAR_ID = 'strigoi-local-ai-release-memory';
    protected static readonly IDE_STATUS_BAR_ID = 'strigoi-ide-open';
    protected static readonly WEB_SEARCH_STATUS_BAR_ID = 'strigoi-web-search-status';
    protected static readonly COMPANION_CLASS = 'strigoi-companion';
    protected static readonly HOME_SHELL_CLASS = 'strigoi-home-shell';
    protected static readonly LEGACY_OLLAMA_MODELS_PREFERENCE = 'ai-features.ollama.ollamaModels';
    protected static readonly DEFAULT_CHAT_AGENT_PREFERENCE = 'ai-features.chat.defaultChatAgent';
    protected static readonly LANGUAGE_MODEL_ALIASES_PREFERENCE = 'ai-features.languageModelAliases';
    protected static readonly DEFAULT_MODEL = 'qwen2.5-coder-7b-instruct-q4-k-m';
    protected static readonly THINKING_LEVELS: readonly ReasoningLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'auto'];

    @inject(MessageService)
    protected readonly messages: MessageService;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    @inject(StatusBar)
    protected readonly statusBar: StatusBar;

    @inject(QuickInputService)
    protected readonly quickInputService: QuickInputService;

    @inject(LocalRuntimeService)
    protected readonly localRuntime: LocalRuntimeService;

    @inject(LocalModelCatalogService)
    protected readonly localModelCatalog: LocalModelCatalogService;

    @inject(FileDialogService)
    protected readonly fileDialogService: FileDialogService;

    @inject(PromptService)
    protected readonly promptService: PromptService;

    @inject(AISettingsService)
    protected readonly aiSettingsService: AISettingsService;

    @inject(ChatService)
    protected readonly chatService: ChatService;

    @inject(PerspectiveService)
    protected readonly perspectiveService: PerspectiveService;

    @inject(StrigoiHomeSessionsWidget)
    protected readonly homeSessions: StrigoiHomeSessionsWidget;

    protected emptyEditor: HTMLElement | undefined;
    protected companion: HTMLElement | undefined;
    protected perspectiveListener: Disposable | undefined;
    protected runtimeRefreshTimer: number | undefined;
    protected lastStrigoiMode: StrigoiMode | undefined;
    protected readonly chatSessionListeners = new Map<string, Disposable>();
    protected readonly responseStartTimes = new Map<string, number>();
    protected lastTelemetry: LocalAiTelemetry | undefined;
    protected thinkingToggle: HTMLButtonElement | undefined;
    protected thinkingToggleObserver: MutationObserver | undefined;
    protected thinkingLevel: ReasoningLevel = 'off';
    protected homeIdeAction: HTMLButtonElement | undefined;
    protected homeTitle: HTMLElement | undefined;
    protected homeLogo: HTMLElement | undefined;
    protected homeModelName: string | undefined;
    protected localModelDownloadInProgress = false;
    protected agentSubagentDownloadInProgress = false;
    protected localModelCatalogModal: HTMLElement | undefined;

    registerPerspectives(service: PerspectiveService): void {
        service.registerPerspective({
            id: STRIGOI_IDE_PERSPECTIVE_ID,
            label: 'Firawynix Workspace IDE',
            viewPlacements: new Map<string, ApplicationShell.Area>([
                ['explorer-view-container', 'left'],
                [ChatViewWidget.ID, 'right'],
                ['problems', 'bottom'],
                ['outputView', 'bottom'],
                ['test-output-view', 'bottom']
            ]),
            primaryViews: { left: 'explorer-view-container', right: ChatViewWidget.ID, bottom: 'problems' },
            onActivate: shell => shell.resize(210, 'bottom')
        });
        service.registerPerspective({
            id: STRIGOI_HOME_PERSPECTIVE_ID,
            label: 'Firawynix Workspace Home',
            viewPlacements: new Map<string, ApplicationShell.Area>([
                [StrigoiHomeSessionsWidget.ID, 'left'],
                [ChatViewWidget.ID, 'main']
            ]),
            chromeOptions: {
                collapseAreas: ['right', 'bottom']
            }
        });
    }

    onStart(_app: FrontendApplication): void {
        this.installEmptyEditor();
        this.installHomeIdeAction();
        this.installHomeTitle();
        this.installHomeLogo();
        this.installThinkingToggle();
        this.synchronizeHomeShell();
        void this.setIdeNavigationStatus();
        void this.setWebSearchStatus();
        this.perspectiveListener = this.perspectiveService.onDidChangePerspective(() => {
            this.synchronizeHomeShell();
            this.updateCompanionVisibility();
            void this.setIdeNavigationStatus();
        });
        this.shell.onDidAddWidget(() => this.updateEmptyEditorVisibility());
        this.shell.onDidRemoveWidget(() => queueMicrotask(() => this.updateEmptyEditorVisibility()));
        this.chatService.onSessionEvent(() => this.monitorChatTelemetry());
        void this.preferences.ready.then(async () => {
            this.preferences.onPreferenceChanged(event => {
                if (event.preferenceName === STRIGOI_LOCAL_RUNTIME_MODEL_PREFERENCE) {
                    void this.refreshLocalRuntimeStatus(false);
                }
                if (event.preferenceName === STRIGOI_LOCAL_RUNTIME_PREFERENCE) {
                    void this.updateLanguageModelAliases(
                        this.getConfiguredModel(),
                        this.preferences.get<string>(STRIGOI_LOCAL_RUNTIME_PREFERENCE, 'llama.cpp') === 'llama.cpp'
                            ? 'llama.cpp'
                            : 'llama.cpp'
                    );
                    void this.refreshLocalRuntimeStatus(false);
                }
                if (event.preferenceName === STRIGOI_MODE_PREFERENCE) {
                    void this.syncAgentMode();
                }
                if (event.preferenceName === STRIGOI_AGENT_ENABLED_PREFERENCE) {
                    // Preserve the old setting as an entry point for people who
                    // configured it before the three-mode workflow existed.
                    void this.preferences.set(
                        STRIGOI_MODE_PREFERENCE,
                        this.preferences.get<boolean>(STRIGOI_AGENT_ENABLED_PREFERENCE, false) ? 'agent' : 'conversation',
                        PreferenceScope.User
                    );
                }
                if (event.preferenceName === STRIGOI_COMPANION_ENABLED_PREFERENCE) {
                    this.updateCompanionVisibility();
                }
            });
            await this.ensureIndependentRuntimeDefaults();
            await this.synchronizeInstallerModelPath();
            await this.ensureStrigoiDefaultAgent();
            await this.ensureStrigoiModeDefaults();
            await this.syncAgentMode();
            await this.initializeThinkingLevel();
            await this.setReleaseMemoryStatus();
            await this.refreshLocalRuntimeStatus(false);
            this.monitorChatTelemetry();
            this.runtimeRefreshTimer ??= window.setInterval(() => {
                this.monitorChatTelemetry();
                void this.refreshLocalRuntimeStatus(false);
            }, 5000);
        });
    }

    onStop(): void {
        if (this.runtimeRefreshTimer !== undefined) {
            window.clearInterval(this.runtimeRefreshTimer);
        }
        for (const listener of this.chatSessionListeners.values()) {
            listener.dispose();
        }
        this.perspectiveListener?.dispose();
        this.shell.node.classList.remove(StrigoiCoreContribution.HOME_SHELL_CLASS);
        this.companion?.remove();
        this.thinkingToggleObserver?.disconnect();
        this.thinkingToggle?.remove();
        this.homeIdeAction?.remove();
        this.homeTitle?.remove();
        this.homeLogo?.remove();
        this.closeLocalModelCatalog();
        document.getElementById('theia:menubar')?.classList.remove('strigoi-home-chrome-hidden');
        document.getElementById('theia-custom-title')?.classList.remove('strigoi-home-chrome-hidden');
        void this.releaseLocalMemory(false);
    }

    async onDidInitializeLayout(): Promise<void> {
        await this.openHome();
        this.installHomeIdeAction();
        this.installHomeTitle();
        this.installHomeLogo();
        this.synchronizeHomeShell();
        requestAnimationFrame(() => this.synchronizeHomeShell());
    }

    protected installEmptyEditor(): void {
        const host = this.shell.mainPanel.node;
        host.classList.add('strigoi-empty-editor-host');

        const emptyEditor = document.createElement('div');
        emptyEditor.className = StrigoiCoreContribution.EMPTY_EDITOR_CLASS;
        emptyEditor.setAttribute('aria-hidden', 'true');

        host.appendChild(emptyEditor);

        this.emptyEditor = emptyEditor;
        this.updateEmptyEditorVisibility();
    }

    protected updateEmptyEditorVisibility(): void {
        this.emptyEditor?.classList.toggle(
            'strigoi-empty-editor-visible',
            this.shell.getWidgets('main').length === 0
        );
    }

    protected installCompanion(): void {
        const companion = document.createElement('div');
        companion.className = StrigoiCoreContribution.COMPANION_CLASS;
        companion.setAttribute('aria-live', 'polite');
        companion.setAttribute('aria-label', 'Companheiro Strigoi');
        const bubble = document.createElement('div');
        bubble.className = 'strigoi-companion-bubble';
        const mascot = document.createElement('div');
        mascot.className = 'strigoi-companion-mascot';
        companion.append(bubble, mascot);
        this.shell.mainPanel.node.appendChild(companion);
        this.companion = companion;
        this.setCompanionMessage('Pronto para caçar bugs.');
        this.updateCompanionVisibility();
    }

    protected installHomeIdeAction(): void {
        const topPanel = document.getElementById('theia-top-panel');
        if (!topPanel || this.homeIdeAction) {
            return;
        }

        const action = document.createElement('button');
        action.className = 'strigoi-home-ide-action';
        action.type = 'button';
        action.textContent = 'Abrir IDE ↗';
        action.title = 'Abrir a IDE completa mantendo a conversa atual';
        action.addEventListener('click', () => void this.openIde());
        topPanel.appendChild(action);
        this.homeIdeAction = action;
    }

    protected installHomeTitle(): void {
        const topPanel = document.getElementById('theia-top-panel');
        if (!topPanel || this.homeTitle) {
            return;
        }
        const title = document.createElement('div');
        title.className = 'strigoi-home-title';
        title.textContent = 'Firawynix Workspace';
        title.setAttribute('aria-hidden', 'true');
        topPanel.appendChild(title);
        this.homeTitle = title;
    }

    protected installHomeLogo(): void {
        const topPanel = document.getElementById('theia-top-panel');
        if (!topPanel || this.homeLogo) {
            return;
        }
        const logo = document.createElement('div');
        logo.className = 'strigoi-home-logo';
        logo.setAttribute('aria-hidden', 'true');
        topPanel.appendChild(logo);
        this.homeLogo = logo;
    }

    protected updateCompanionVisibility(): void {
        this.companion?.classList.remove('strigoi-companion-visible');
    }

    protected synchronizeHomeShell(): void {
        const home = this.perspectiveService.getActivePerspectiveId() === STRIGOI_HOME_PERSPECTIVE_ID;
        this.shell.node.classList.toggle(StrigoiCoreContribution.HOME_SHELL_CLASS, home);
        this.shell.node.classList.toggle('strigoi-ide-shell', !home);
        document.getElementById('theia:menubar')?.classList.toggle('strigoi-home-chrome-hidden', home);
        document.getElementById('theia-custom-title')?.classList.toggle('strigoi-home-chrome-hidden', home);

        const chatWidget = this.shell.getWidgetById(ChatViewWidget.ID);
        const chatTabBar = chatWidget ? this.shell.getTabBarFor(chatWidget) : undefined;
        if (chatTabBar) {
            if (home) {
                chatTabBar.hide();
            } else {
                chatTabBar.show();
            }
        }

        if (home) {
            this.homeSessions.show();
            this.shell.expandPanel('left');
            const sidebarWidth = Math.min(360, Math.max(280, Math.round(window.innerWidth * 0.215)));
            this.shell.resize(sidebarWidth, 'left');
            void this.shell.collapsePanel('right');
            // A collapsed Theia side panel can still reserve its activity-rail
            // width. Home has its own companion rail, so remove that empty
            // column altogether and let the conversation canvas reach the
            // same right inset as the other cards.
            this.shell.rightPanelHandler.container.hide();
            void this.shell.collapsePanel('bottom');
            this.synchronizeHomeModelLabel();
        } else {
            this.homeSessions.hide();
            this.shell.expandPanel('left');
            this.shell.rightPanelHandler.container.show();
            this.shell.expandPanel('right');
            this.shell.resize(Math.min(340, Math.max(240, Math.round(window.innerWidth * 0.20))), 'left');
            this.shell.resize(Math.min(540, Math.max(360, Math.round(window.innerWidth * 0.30))), 'right');
        }

        requestAnimationFrame(() => {
            // Perspective CSS changes direct-child size constraints; invalidate the
            // nested Lumino layouts as well as the shell to avoid rail/tree overlap.
            for (const handler of [this.shell.leftPanelHandler, this.shell.rightPanelHandler]) {
                handler.tabBar.parent?.fit();
                handler.toolBar.parent?.fit();
                handler.container.fit();
            }
            this.shell.fit();
        });
    }

    protected synchronizeHomeModelLabel(): void {
        const label = document.querySelector<HTMLElement>('.theia-ChatInput-ModelSelector .theia-select-component-label');
        if (!label) {
            return;
        }
        label.dataset.strigoiOriginalLabel ??= label.textContent || 'Default';
        const nextLabel = this.homeModelName
            ? this.formatHomeModelName(this.homeModelName)
            : label.dataset.strigoiOriginalLabel;
        // This runs from a MutationObserver. Replacing an unchanged text node
        // emits another childList mutation and would keep the renderer in a loop.
        if (label.textContent !== nextLabel) {
            label.textContent = nextLabel;
        }
    }

    protected formatHomeModelName(model: string): string {
        const displayName = model.replace(/\.gguf$/i, '');
        const normalized = displayName.toLowerCase();
        if (normalized.includes('qwen3-coder')) {
            return 'Qwen3 Coder';
        }
        // Qwen 3.8 and its quantization are materially different from Qwen 3.
        // Never collapse the selected local model into a misleading family label.
        if (normalized.includes('qwen3.8')) {
            return displayName.replace(/[-_]+/g, ' ');
        }
        if (normalized.includes('qwen3')) {
            return displayName.replace(/[-_]+/g, ' ');
        }
        if (normalized.includes('qwen2.5-coder')) {
            return 'Qwen Coder';
        }
        if (normalized.includes('gpt-oss')) {
            return 'GPT-OSS';
        }
        return displayName || 'Local';
    }

    protected setCompanionMessage(message: string): void {
        const bubble = this.companion?.querySelector<HTMLElement>('.strigoi-companion-bubble');
        if (bubble) {
            bubble.textContent = message;
        }
    }

    protected async setIdeNavigationStatus(): Promise<void> {
        const chatFirst = this.perspectiveService.getActivePerspectiveId() === STRIGOI_HOME_PERSPECTIVE_ID;
        await this.statusBar.setElement(StrigoiCoreContribution.IDE_STATUS_BAR_ID, {
            text: chatFirst ? 'IDE' : 'Home',
            alignment: StatusBarAlignment.RIGHT,
            color: chatFirst ? '#bd93f9' : '#8be9fd',
            tooltip: chatFirst ? 'Abrir a IDE completa mantendo o chat e o projeto atuais.' : 'Voltar para a Home chat-first.',
            command: chatFirst ? OPEN_STRIGOI_IDE.id : OPEN_STRIGOI_HOME.id,
            priority: 97
        });
    }

    protected async setWebSearchStatus(): Promise<void> {
        const mode = this.preferences.get<string>(STRIGOI_WEB_SEARCH_MODE_PREFERENCE, 'auto');
        const labels: Record<string, string> = {
            off: 'Web: desligada',
            auto: 'Web: Auto',
            on: 'Web: ligada'
        };
        const tooltips: Record<string, string> = {
            off: 'Pesquisa web desligada. Clique para ativar o modo Auto.',
            auto: 'Pesquisa web automática: o agente consulta fontes quando necessário. Clique para ligar sempre.',
            on: 'Pesquisa web disponível sempre que o agente precisar. Clique para desligar.'
        };
        await this.statusBar.setElement(StrigoiCoreContribution.WEB_SEARCH_STATUS_BAR_ID, {
            text: `$(globe) ${labels[mode] ?? labels.auto}`,
            alignment: StatusBarAlignment.RIGHT,
            color: mode === 'off' ? '#6272a4' : '#8be9fd',
            tooltip: tooltips[mode] ?? tooltips.auto,
            command: TOGGLE_STRIGOI_WEB_SEARCH.id,
            priority: 96
        });
    }

    protected async cycleWebSearchMode(): Promise<void> {
        const current = this.preferences.get<string>(STRIGOI_WEB_SEARCH_MODE_PREFERENCE, 'auto');
        const next = current === 'off' ? 'auto' : current === 'auto' ? 'on' : 'off';
        await this.preferences.set(STRIGOI_WEB_SEARCH_MODE_PREFERENCE, next, PreferenceScope.User);
        await this.setWebSearchStatus();
        const labels: Record<string, string> = { off: 'desligada', auto: 'automática', on: 'ligada' };
        this.setCompanionMessage(`Pesquisa web ${labels[next]}.`);
    }

    protected async openIde(): Promise<void> {
        await this.perspectiveService.switchPerspective(STRIGOI_IDE_PERSPECTIVE_ID);
        this.synchronizeHomeShell();
        this.updateCompanionVisibility();
        await this.setIdeNavigationStatus();
    }

    protected async openHome(): Promise<void> {
        await this.perspectiveService.switchPerspective(STRIGOI_HOME_PERSPECTIVE_ID);
        this.synchronizeHomeShell();
        this.updateCompanionVisibility();
        await this.setIdeNavigationStatus();
    }

    protected async refreshLocalRuntimeStatus(showNotification: boolean): Promise<void> {
        this.setCompanionMessage('Acordando a inteligência local…');
        await this.setLocalAiStatus('$(sync~spin) IA local: verificando', '#8be9fd', 'Consultando o runtime local...');

        const status = await this.localRuntime.getStatus(this.getLocalRuntimeConfiguration());
        if (status.state === 'ready') {
            const model = status.detectedModel?.name ?? status.expectedModel;
            this.homeModelName = model;
            this.synchronizeHomeModelLabel();
            if (status.isLoaded) {
                this.setCompanionMessage('Modelo acordado — caçando bugs.');
                const memory = status.loadedModelMemoryBytes
                    ? ` · ${this.formatMemory(status.loadedModelMemoryBytes)} em memória`
                    : '';
                await this.setLocalAiStatus(`$(pass-filled) Modelo carregado: ${model}`, '#50fa7b', `${model} está carregado${memory}. Clique para selecionar outro modelo local.`);
            } else {
                this.setCompanionMessage('Modelo em standby — pronto quando você chamar.');
                await this.setLocalAiStatus(`$(circle-outline) Modelo instalado: ${model}`, '#8be9fd', `${model} está instalado, mas ainda não foi carregado na memória. Clique para selecionar outro modelo local.`);
            }
            if (showNotification) {
                this.messages.info(`IA local pronta: ${model}.`);
            }
            return;
        }

        this.homeModelName = undefined;
        this.synchronizeHomeModelLabel();

        if (status.state === 'missing-model') {
            this.setCompanionMessage('Falta um modelo local para eu despertar.');
            await this.setLocalAiStatus(
                '$(warning) Modelo local: ausente',
                '#ffb86c',
                status.message ?? 'O modelo configurado não foi encontrado. Clique para receber orientação.',
                SHOW_LOCAL_AI_ONBOARDING.id
            );
            if (showNotification) {
                this.messages.warn(status.message ?? 'O modelo homologado não foi encontrado.');
            }
            return;
        }

        await this.setLocalAiStatus(
            '$(circle-slash) Modelo local: offline',
            '#ff5555',
            `${status.message ?? 'Runtime local indisponível.'} Clique para receber orientação.`,
            SHOW_LOCAL_AI_ONBOARDING.id
        );
        this.setCompanionMessage('O runtime local está dormindo.');
        if (showNotification) {
            this.messages.error(status.message ?? 'Runtime local indisponível.');
        }
    }

    protected getConfiguredModel(): string {
        return this.preferences.get<string>(STRIGOI_LOCAL_RUNTIME_MODEL_PREFERENCE, StrigoiCoreContribution.DEFAULT_MODEL);
    }

    protected getLocalRuntimeConfiguration(): LocalRuntimeConfiguration {
        return {
            provider: 'llama.cpp',
            expectedModel: this.getConfiguredModel(),
            llamaServerPath: this.preferences.get<string>(STRIGOI_LLAMA_CPP_SERVER_PATH_PREFERENCE, '') || undefined,
            llamaModelPath: this.preferences.get<string>(STRIGOI_LLAMA_CPP_MODEL_PATH_PREFERENCE, '') || undefined,
            modelsDirectory: this.preferences.get<string>(STRIGOI_LOCAL_MODELS_DIRECTORY_PREFERENCE, '') || undefined
        };
    }

    protected formatMemory(bytes: number): string {
        return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
    }

    protected formatTokens(tokens: number): string {
        return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
    }

    protected monitorChatTelemetry(): void {
        const activeSessionIds = new Set(this.chatService.getSessions().map(session => session.id));
        for (const [sessionId, listener] of this.chatSessionListeners) {
            if (!activeSessionIds.has(sessionId)) {
                listener.dispose();
                this.chatSessionListeners.delete(sessionId);
            }
        }
        for (const session of this.chatService.getSessions()) {
            if (!this.chatSessionListeners.has(session.id)) {
                this.chatSessionListeners.set(session.id, session.model.onDidChange(() => this.updateChatTelemetry()));
            }
        }
        this.updateChatTelemetry();
    }

    protected updateChatTelemetry(): void {
        let newest: LocalAiTelemetry | undefined;
        for (const session of this.chatService.getSessions()) {
            for (const request of session.model.getRequests()) {
                const response = request.response;
                if (!response.isComplete) {
                    this.responseStartTimes.set(response.id, this.responseStartTimes.get(response.id) ?? Date.now());
                    continue;
                }
                const usage = response.tokenUsage;
                if (!usage) {
                    continue;
                }
                const startedAt = this.responseStartTimes.get(response.id);
                const elapsedSeconds = startedAt ? (Date.now() - startedAt) / 1000 : undefined;
                newest = {
                    model: response.languageModel,
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    tokensPerSecond: elapsedSeconds && elapsedSeconds > 0
                        ? usage.outputTokens / elapsedSeconds
                        : undefined
                };
                this.responseStartTimes.delete(response.id);
            }
        }
        if (!newest) {
            return;
        }
        this.lastTelemetry = newest;
        const speed = newest.tokensPerSecond ? ` · ${newest.tokensPerSecond.toFixed(1)} tok/s` : '';
        void this.statusBar.setElement('strigoi-local-ai-telemetry', {
            text: `$(pulse) IA: ${this.formatTokens(newest.inputTokens)} ctx${speed}`,
            alignment: StatusBarAlignment.RIGHT,
            color: '#bd93f9',
            tooltip: `Última resposta${newest.model ? ` (${newest.model})` : ''}: ${newest.inputTokens.toLocaleString()} tokens de contexto e ${newest.outputTokens.toLocaleString()} tokens de saída${speed}. Clique para ver detalhes.`,
            command: SHOW_LOCAL_AI_TELEMETRY.id,
            priority: 98
        });
    }

    protected async showLocalAiOnboarding(): Promise<void> {
        const status = await this.localRuntime.getStatus(this.getLocalRuntimeConfiguration());
        if (status.state === 'ready') {
            const action = await this.messages.info(
                `${status.detectedModel?.name ?? status.expectedModel} está disponível no ${status.provider}. Se quiser, escolha outro modelo já instalado.`,
                'Selecionar modelo'
            );
            if (action === 'Selecionar modelo') {
                await this.selectLocalModel();
            }
            return;
        }
        if (status.state === 'missing-model') {
            const action = await this.messages.warn(
                status.availableModelCount > 0
                    ? `O modelo configurado não foi encontrado, mas há ${status.availableModelCount} modelo(s) local(is) disponível(is).`
                    : 'O runtime está pronto, mas ainda não há um modelo local registrado. Você pode baixar um GGUF oficial verificado ou escolher um arquivo que já possui.',
                status.availableModelCount > 0 ? 'Selecionar modelo' : 'Baixar modelo verificado'
            );
            if (action === 'Selecionar modelo') {
                await this.selectLocalModel();
            } else if (action === 'Baixar modelo verificado') {
                await this.downloadVerifiedLocalModel();
            }
            return;
        }
        const action = await this.messages.warn(
            'O Firawynix Workspace não encontrou o runtime local próprio. Reinstale o Strigoi ou escolha um arquivo GGUF no seletor de modelos.',
            'Tentar novamente'
        );
        if (action === 'Tentar novamente') {
            await this.refreshLocalRuntimeStatus(true);
        }
    }

    protected async downloadVerifiedLocalModel(): Promise<void> {
        if (this.localModelDownloadInProgress) {
            this.messages.info('Já há um download de modelo local em andamento.');
            return;
        }

        let catalog;
        try {
            catalog = await this.localModelCatalog.getCatalog();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'não foi possível consultar o catálogo.';
            this.messages.error(`Não foi possível abrir o catálogo de modelos: ${message}`);
            return;
        }
        const items: CatalogModelQuickPickItem[] = catalog.models.map(entry => ({
            label: entry.name,
            description: `${entry.parameterSize} · ${entry.quantization} · ${this.formatMemory(entry.artifact.sizeBytes)}`,
            detail: `${entry.license} · contexto até ${entry.contextLength.toLocaleString()} tokens · mínimo ${entry.minimumRamGb} GB RAM`,
            entry
        }));
        const selected = await this.quickInputService.showQuickPick(items, {
            title: 'Baixar modelo local verificado',
            placeholder: 'Modelos oficiais com checksum e licença registrados',
            matchOnDescription: true,
            matchOnDetail: true
        });
        if (!selected) {
            return;
        }

        const size = this.formatMemory(selected.entry.artifact.sizeBytes);
        const confirm = await this.messages.info(
            `${selected.entry.name} ocupa ${size}. O download vem do repositório oficial e terá o checksum conferido antes de ser usado.`,
            `Baixar ${size}`
        );
        if (confirm !== `Baixar ${size}`) {
            return;
        }

        const destination = await this.fileDialogService.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Salvar modelo nesta pasta',
            title: 'Escolher pasta para os modelos locais do Strigoi'
        });
        if (!destination) {
            return;
        }

        this.localModelDownloadInProgress = true;
        const directory = destination.path.fsPath();
        await this.setLocalAiStatus('$(cloud-download) Baixando modelo local…', '#8be9fd', 'Download em andamento; o checksum será validado antes de o modelo aparecer no Firawynix Workspace.');
        this.setCompanionMessage('Buscando um novo grimório local…');
        try {
            const modelPath = await this.localModelCatalog.downloadModel(selected.entry.id, directory);
            await this.preferences.set(STRIGOI_LOCAL_MODELS_DIRECTORY_PREFERENCE, directory, PreferenceScope.User);
            await this.preferences.set(STRIGOI_LLAMA_CPP_MODEL_PATH_PREFERENCE, modelPath, PreferenceScope.User);
            await this.preferences.set(STRIGOI_LOCAL_RUNTIME_PREFERENCE, 'llama.cpp', PreferenceScope.User);
            await this.preferences.set(STRIGOI_LOCAL_RUNTIME_MODEL_PREFERENCE, selected.entry.id, PreferenceScope.User);
            await this.updateLanguageModelAliases(selected.entry.id, 'llama.cpp');
            this.messages.info(`${selected.entry.name} está pronto para ser usado pelo runtime próprio.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'o download não foi concluído.';
            this.messages.error(`Não foi possível baixar o modelo: ${message}`);
        } finally {
            this.localModelDownloadInProgress = false;
            await this.refreshLocalRuntimeStatus(false);
        }
    }

    protected async recommendAndInstallLocalModel(): Promise<void> {
        if (this.localModelDownloadInProgress) {
            this.messages.info('Já há um download de modelo em andamento.');
            return;
        }
        try {
            const [profile, catalog] = await Promise.all([
                this.localModelCatalog.getHardwareProfile(),
                this.localModelCatalog.getCatalog()
            ]);
            const recommendation = recommendLocalModel(profile, catalog.models);
            if (!recommendation.model) {
                this.messages.warn(recommendation.reason);
                return;
            }
            const entry = recommendation.model;
            const size = this.formatMemory(entry.artifact.sizeBytes);
            const choice = await this.messages.info(
                `${recommendation.reason}\nDownload: ${size}. Origem: ${entry.artifact.repository}. Pasta: ${profile.defaultModelsDirectory}. O SHA-256 será conferido.`,
                'Baixar e configurar'
            );
            if (choice !== 'Baixar e configurar') { return; }
            this.localModelDownloadInProgress = true;
            await this.setLocalAiStatus('$(cloud-download) Baixando IA recomendada…', '#52e4ee', 'Download e verificação do modelo local.');
            try {
                const modelPath = await this.localModelCatalog.downloadModel(entry.id, profile.defaultModelsDirectory);
                await this.useCatalogModel(entry, modelPath, profile.defaultModelsDirectory);
                this.messages.info(`${entry.name} foi configurado para a IDE. Skills e modos do agente continuam disponíveis.`);
            } finally {
                this.localModelDownloadInProgress = false;
                await this.refreshLocalRuntimeStatus(false);
            }
        } catch (error) {
            this.messages.error(`Não foi possível configurar a IA recomendada: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /** A visual catalogue for the same checksum-protected GGUF registry used by the installer. */
    protected async openLocalModelCatalog(): Promise<void> {
        if (this.localModelCatalogModal) {
            this.localModelCatalogModal.querySelector<HTMLElement>('.strigoi-model-catalog-search')?.focus();
            return;
        }

        let catalog;
        try {
            catalog = await this.localModelCatalog.getCatalog();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'não foi possível consultar o catálogo.';
            this.messages.error(`Não foi possível abrir o catálogo de modelos: ${message}`);
            return;
        }
        if (catalog.models.length === 0) {
            this.messages.warn('O catálogo de modelos verificados está vazio.');
            return;
        }

        let directory = await this.resolveLocalModelsDirectory();
        let installedPaths = new Map<string, string>();
        const refreshInstalled = async (): Promise<void> => {
            installedPaths = new Map<string, string>();
            if (!directory) {
                return;
            }
            const models = await this.localRuntime.getModels({
                ...this.getLocalRuntimeConfiguration(),
                modelsDirectory: directory
            });
            for (const entry of catalog.models) {
                const installed = models.find(model => this.sameFileName(model.filePath, entry.artifact.file));
                if (installed?.filePath) {
                    installedPaths.set(entry.id, installed.filePath);
                }
            }
        };
        try {
            await refreshInstalled();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'não foi possível ler os modelos locais.';
            this.messages.warn(`O catálogo abriu, mas não foi possível conferir os modelos instalados: ${message}`);
        }

        const state: { query: string; category: string; selectedId: string; downloading: boolean } = {
            query: '',
            category: 'Todos',
            selectedId: catalog.models.find(model => model.id === this.getConfiguredModel())?.id ?? catalog.models[0].id,
            downloading: false
        };
        const overlay = document.createElement('div');
        overlay.className = 'strigoi-model-catalog-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', 'Explorar modelos locais');
        const modal = document.createElement('section');
        modal.className = 'strigoi-model-catalog-modal';
        overlay.appendChild(modal);
        this.localModelCatalogModal = overlay;

        const close = (): void => this.closeLocalModelCatalog();
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                close();
            }
        };
        overlay.addEventListener('mousedown', event => {
            if (event.target === overlay) {
                close();
            }
        });
        document.addEventListener('keydown', onKeyDown);
        overlay.addEventListener('strigoi-catalog-close', () => document.removeEventListener('keydown', onKeyDown), { once: true });

        const modelMatches = (entry: LocalModelCatalogEntry): boolean => {
            const needle = state.query.trim().toLocaleLowerCase();
            const searchable = `${entry.name} ${entry.family} ${entry.parameterSize} ${this.catalogTags(entry).join(' ')}`.toLocaleLowerCase();
            return (!needle || searchable.includes(needle)) &&
                (state.category === 'Todos' || this.catalogTags(entry).includes(state.category));
        };
        const currentEntries = (): LocalModelCatalogEntry[] => catalog.models.filter(modelMatches);
        const ensureSelected = (): LocalModelCatalogEntry => {
            const entries = currentEntries();
            if (!entries.some(entry => entry.id === state.selectedId)) {
                state.selectedId = entries[0]?.id ?? catalog.models[0].id;
            }
            return catalog.models.find(entry => entry.id === state.selectedId) ?? catalog.models[0];
        };

        const render = (): void => {
            const selected = ensureSelected();
            modal.replaceChildren();

            const heading = document.createElement('header');
            heading.className = 'strigoi-model-catalog-heading';
            const title = document.createElement('div');
            const h1 = document.createElement('h1');
            h1.textContent = 'Explorar modelos locais';
            const subtitle = document.createElement('p');
            subtitle.textContent = 'Modelos oficiais para executar no seu dispositivo.';
            title.append(h1, subtitle);
            const closeButton = document.createElement('button');
            closeButton.className = 'strigoi-model-catalog-close';
            closeButton.type = 'button';
            closeButton.title = 'Fechar catálogo';
            closeButton.setAttribute('aria-label', 'Fechar catálogo');
            closeButton.innerHTML = '<span class="codicon codicon-close" aria-hidden="true"></span>';
            closeButton.addEventListener('click', close);
            heading.append(title, closeButton);

            const content = document.createElement('div');
            content.className = 'strigoi-model-catalog-content';
            const sidebar = document.createElement('aside');
            sidebar.className = 'strigoi-model-catalog-sidebar';
            const search = document.createElement('input');
            search.className = 'strigoi-model-catalog-search';
            search.type = 'search';
            search.placeholder = 'Buscar por nome, família ou tarefa…';
            search.value = state.query;
            search.setAttribute('aria-label', 'Buscar modelos');
            search.addEventListener('input', () => {
                state.query = search.value;
                render();
            });
            const filters = document.createElement('div');
            filters.className = 'strigoi-model-catalog-filters';
            for (const category of ['Todos', 'Agênticos', 'Coding', 'Raciocínio', 'Leves']) {
                const filter = document.createElement('button');
                filter.type = 'button';
                filter.textContent = category;
                filter.className = 'strigoi-model-catalog-filter';
                filter.classList.toggle('active', state.category === category);
                filter.addEventListener('click', () => {
                    state.category = category;
                    render();
                });
                filters.appendChild(filter);
            }
            const listTitle = document.createElement('h2');
            listTitle.textContent = 'Modelos verificados';
            const list = document.createElement('div');
            list.className = 'strigoi-model-catalog-list';
            const entries = currentEntries();
            if (entries.length === 0) {
                const empty = document.createElement('p');
                empty.className = 'strigoi-model-catalog-empty';
                empty.textContent = 'Nenhum modelo corresponde à busca.';
                list.appendChild(empty);
            }
            for (const entry of entries) {
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'strigoi-model-catalog-card';
                card.classList.toggle('active', entry.id === selected.id);
                const cardTitle = document.createElement('strong');
                cardTitle.textContent = entry.name;
                const cardDescription = document.createElement('span');
                cardDescription.textContent = this.catalogDescription(entry);
                const cardMeta = document.createElement('span');
                cardMeta.className = 'strigoi-model-catalog-card-meta';
                cardMeta.textContent = installedPaths.has(entry.id) ? '✓ Instalado' : this.formatMemory(entry.artifact.sizeBytes);
                card.append(cardTitle, cardDescription, cardMeta);
                card.addEventListener('click', () => {
                    state.selectedId = entry.id;
                    render();
                });
                list.appendChild(card);
            }
            const privacy = document.createElement('p');
            privacy.className = 'strigoi-model-catalog-privacy';
            privacy.textContent = 'Os modelos executam localmente no seu dispositivo.';
            sidebar.append(search, filters, listTitle, list, privacy);

            const detail = document.createElement('article');
            detail.className = 'strigoi-model-catalog-detail';
            const detailTitle = document.createElement('h2');
            detailTitle.textContent = selected.name;
            const description = document.createElement('p');
            description.className = 'strigoi-model-catalog-description';
            description.textContent = this.catalogDescription(selected);
            const tags = document.createElement('div');
            tags.className = 'strigoi-model-catalog-tags';
            this.catalogTags(selected).forEach(tag => {
                const chip = document.createElement('span');
                chip.textContent = tag;
                tags.appendChild(chip);
            });
            const stats = document.createElement('dl');
            stats.className = 'strigoi-model-catalog-stats';
            const values: Array<[string, string]> = [
                ['Parâmetros', selected.parameterSize],
                ['Família', selected.family],
                ['Formato', selected.quantization],
                ['Contexto', `${selected.contextLength.toLocaleString()} tokens`],
                ['Licença', selected.license]
            ];
            values.forEach(([label, value]) => {
                const item = document.createElement('div');
                const term = document.createElement('dt');
                term.textContent = label;
                const definition = document.createElement('dd');
                definition.textContent = value;
                item.append(term, definition);
                stats.appendChild(item);
            });
            const downloadHeading = document.createElement('h3');
            downloadHeading.textContent = 'Download verificado';
            const artifact = document.createElement('div');
            artifact.className = 'strigoi-model-catalog-artifact';
            const artifactName = document.createElement('strong');
            artifactName.textContent = selected.artifact.file;
            const artifactMeta = document.createElement('span');
            artifactMeta.textContent = `${selected.quantization} · ${this.formatMemory(selected.artifact.sizeBytes)} · mínimo ${selected.minimumRamGb} GB RAM`;
            artifact.append(artifactName, artifactMeta);
            const action = document.createElement('button');
            action.className = 'strigoi-model-catalog-action';
            action.type = 'button';
            action.disabled = state.downloading;
            const installedPath = installedPaths.get(selected.id);
            action.textContent = state.downloading
                ? 'Baixando e verificando…'
                : installedPath ? 'Usar este modelo' : `Baixar e usar · ${this.formatMemory(selected.artifact.sizeBytes)}`;
            action.addEventListener('click', () => void this.installOrUseCatalogModel(selected, installedPath, directory, state, refreshInstalled, render));
            const guarantee = document.createElement('p');
            guarantee.className = 'strigoi-model-catalog-guarantee';
            guarantee.textContent = 'Checksum e licença verificados antes da instalação.';
            const about = document.createElement('section');
            about.className = 'strigoi-model-catalog-about';
            const aboutTitle = document.createElement('h3');
            aboutTitle.textContent = 'Sobre este modelo';
            const aboutCopy = document.createElement('p');
            aboutCopy.textContent = this.catalogAbout(selected);
            about.append(aboutTitle, aboutCopy);
            detail.append(detailTitle, description, tags, stats, downloadHeading, artifact, action, guarantee, about);
            content.append(sidebar, detail);
            modal.append(heading, content);
            queueMicrotask(() => search.focus());
        };
        render();
        document.body.appendChild(overlay);
    }

    protected closeLocalModelCatalog(): void {
        const modal = this.localModelCatalogModal;
        if (!modal) {
            return;
        }
        this.localModelCatalogModal = undefined;
        modal.dispatchEvent(new Event('strigoi-catalog-close'));
        modal.remove();
    }

    protected catalogTags(entry: LocalModelCatalogEntry): string[] {
        const searchable = `${entry.id} ${entry.family}`.toLocaleLowerCase();
        const tags = ['Agênticos'];
        if (searchable.includes('coder')) {
            tags.push('Coding');
        }
        if (searchable.includes('qwen3') || searchable.includes('gpt-oss')) {
            tags.push('Raciocínio');
        }
        if (entry.artifact.sizeBytes <= 5 * 1024 ** 3) {
            tags.push('Leves');
        }
        return tags;
    }

    protected catalogDescription(entry: LocalModelCatalogEntry): string {
        const tags = this.catalogTags(entry);
        if (tags.includes('Coding') && tags.includes('Raciocínio')) {
            return 'Modelo local para programação, ferramentas e raciocínio.';
        }
        if (tags.includes('Coding')) {
            return 'Modelo especializado em programação e revisão de código.';
        }
        if (tags.includes('Raciocínio')) {
            return 'Modelo local para raciocínio, ferramentas e tarefas agênticas.';
        }
        return 'Modelo local leve para tarefas auxiliares e conversas.';
    }

    protected catalogAbout(entry: LocalModelCatalogEntry): string {
        return `${entry.name} é distribuído pelo repositório oficial registrado no catálogo do Firawynix Workspace. O arquivo GGUF é conferido por SHA-256 antes de ser usado pelo runtime local.`;
    }

    protected async installOrUseCatalogModel(
        entry: LocalModelCatalogEntry,
        installedPath: string | undefined,
        currentDirectory: string | undefined,
        state: { downloading: boolean },
        refreshInstalled: () => Promise<void>,
        render: () => void
    ): Promise<void> {
        if (this.localModelDownloadInProgress || state.downloading) {
            return;
        }
        let directory = currentDirectory;
        if (!directory) {
            const destination = await this.fileDialogService.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Salvar modelos nesta pasta',
                title: 'Escolher pasta para os modelos locais do Strigoi'
            });
            if (!destination) {
                return;
            }
            directory = destination.path.fsPath();
            await this.preferences.set(STRIGOI_LOCAL_MODELS_DIRECTORY_PREFERENCE, directory, PreferenceScope.User);
        }
        if (installedPath) {
            await this.useCatalogModel(entry, installedPath, directory);
            this.closeLocalModelCatalog();
            return;
        }

        this.localModelDownloadInProgress = true;
        state.downloading = true;
        render();
        await this.setLocalAiStatus('$(cloud-download) Baixando modelo local…', '#8be9fd', 'Download em andamento; o checksum será validado antes de o modelo aparecer no Firawynix Workspace.');
        this.setCompanionMessage('Buscando um novo grimório local…');
        try {
            const modelPath = await this.localModelCatalog.downloadModel(entry.id, directory);
            await this.useCatalogModel(entry, modelPath, directory);
            this.messages.info(`${entry.name} está pronto para ser usado pelo runtime próprio.`);
            this.closeLocalModelCatalog();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'o download não foi concluído.';
            this.messages.error(`Não foi possível baixar o modelo: ${message}`);
            state.downloading = false;
            await refreshInstalled();
            render();
        } finally {
            this.localModelDownloadInProgress = false;
            await this.refreshLocalRuntimeStatus(false);
        }
    }

    protected async useCatalogModel(entry: LocalModelCatalogEntry, modelPath: string, directory: string): Promise<void> {
        await this.preferences.set(STRIGOI_LOCAL_MODELS_DIRECTORY_PREFERENCE, directory, PreferenceScope.User);
        await this.preferences.set(STRIGOI_LLAMA_CPP_MODEL_PATH_PREFERENCE, modelPath, PreferenceScope.User);
        await this.preferences.set(STRIGOI_LOCAL_RUNTIME_PREFERENCE, 'llama.cpp', PreferenceScope.User);
        await this.preferences.set(STRIGOI_LOCAL_RUNTIME_MODEL_PREFERENCE, entry.id, PreferenceScope.User);
        await this.updateLanguageModelAliases(entry.id, 'llama.cpp');
    }

    protected async showLocalAiTelemetry(): Promise<void> {
        const status = await this.localRuntime.getStatus(this.getLocalRuntimeConfiguration());
        const model = status.detectedModel?.name ?? status.expectedModel;
        const context = status.detectedModel?.contextLength
            ? `${status.detectedModel.contextLength.toLocaleString()} tokens`
            : 'não informado pelo modelo';
        const latest = this.lastTelemetry
            ? `\nÚltima resposta: ${this.lastTelemetry.inputTokens.toLocaleString()} tokens de contexto e ${this.lastTelemetry.outputTokens.toLocaleString()} tokens de saída${this.lastTelemetry.tokensPerSecond ? ` a ${this.lastTelemetry.tokensPerSecond.toFixed(1)} tok/s` : ''}.`
            : '\nAinda não há uma resposta concluída nesta sessão para medir.';
        await this.messages.info(`Modelo ativo: ${model}\nCapacidade de contexto: ${context}.${latest}`);
    }

    protected async selectLocalModel(): Promise<void> {
        let models;
        try {
            models = await this.localRuntime.getModels(this.getLocalRuntimeConfiguration());
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Não foi possível consultar os modelos locais.';
            this.messages.error(`Não foi possível abrir o seletor de modelos: ${message}`);
            await this.refreshLocalRuntimeStatus(false);
            return;
        }

        if (models.length === 0) {
            this.messages.warn('Nenhum modelo local foi encontrado no runtime selecionado.');
            return;
        }

        const currentModel = this.getConfiguredModel();
        const items: LocalModelQuickPickItem[] = models.map(model => ({
            label: model.name,
            description: [model.parameterSize, model.quantizationLevel].filter(Boolean).join(' · '),
            detail: model.contextLength ? `Contexto: ${model.contextLength.toLocaleString()} tokens` : undefined,
            model: model.name,
            filePath: model.filePath
        }));
        const selected = await this.quickInputService.showQuickPick(items, {
            title: 'Selecionar modelo local',
            placeholder: 'Modelos instalados no runtime local selecionado',
            matchOnDescription: true,
            matchOnDetail: true,
            activeItem: items.find(item => item.model === currentModel || item.model === `${currentModel}:latest`)
        });
        if (!selected) {
            return;
        }

        await this.preferences.set(STRIGOI_LOCAL_RUNTIME_MODEL_PREFERENCE, selected.model, PreferenceScope.User);
        const provider = 'llama.cpp';
        if (provider === 'llama.cpp' && selected.filePath) {
            await this.preferences.set(STRIGOI_LLAMA_CPP_MODEL_PATH_PREFERENCE, selected.filePath, PreferenceScope.User);
        }
        await this.updateLanguageModelAliases(selected.model, provider);
        await this.refreshLocalRuntimeStatus(false);
        this.messages.info(`Modelo local selecionado: ${selected.model}.`);
    }

    protected async updateLanguageModelAliases(model: string, provider = 'llama.cpp'): Promise<void> {
        const aliases = this.preferences.get<Record<string, { selectedModel: string }>>(
            StrigoiCoreContribution.LANGUAGE_MODEL_ALIASES_PREFERENCE,
            {}
        );
        const selectedModel = `${provider}/${model}`;
        const updatedAliases = Object.fromEntries(
            Object.keys(aliases).map(alias => [alias, { selectedModel }])
        );
        await this.preferences.set(
            StrigoiCoreContribution.LANGUAGE_MODEL_ALIASES_PREFERENCE,
            updatedAliases,
            PreferenceScope.User
        );
    }

    protected async ensureIndependentRuntimeDefaults(): Promise<void> {
        if (this.preferences.get<boolean>(STRIGOI_LOCAL_RUNTIME_MIGRATED_PREFERENCE, false)) {
            return;
        }
        const legacyModels = this.preferences.get<string[]>(StrigoiCoreContribution.LEGACY_OLLAMA_MODELS_PREFERENCE, []);
        const legacyModel = legacyModels[0];
        const configuredModel = this.getConfiguredModel();
        const sourceModel = legacyModel ?? configuredModel;
        const model = sourceModel.startsWith('strigoi-qwen3.8')
            ? 'qwen2.5-coder-7b-instruct-q4-k-m'
            : sourceModel;
        await this.preferences.set(STRIGOI_LOCAL_RUNTIME_PREFERENCE, 'llama.cpp', PreferenceScope.User);
        await this.preferences.set(STRIGOI_LOCAL_RUNTIME_MODEL_PREFERENCE, model, PreferenceScope.User);
        const aliases = this.preferences.get<Record<string, { selectedModel: string }>>(
            StrigoiCoreContribution.LANGUAGE_MODEL_ALIASES_PREFERENCE,
            {}
        );
        if (Object.values(aliases).some(alias => alias.selectedModel?.startsWith('ollama/'))) {
            await this.updateLanguageModelAliases(model, 'llama.cpp');
        }
        await this.preferences.set(STRIGOI_LOCAL_RUNTIME_MIGRATED_PREFERENCE, true, PreferenceScope.User);
    }

    protected async synchronizeInstallerModelPath(): Promise<void> {
        // Always refresh this mapping. Previous releases could persist a
        // path from a failed install, which otherwise prevented recovery
        // after the GGUF was later placed in the installation models folder.
        const status = await this.localRuntime.getStatus(this.getLocalRuntimeConfiguration());
        const modelPath = status.detectedModel?.filePath;
        if (status.state !== 'ready' || !modelPath) {
            return;
        }
        const separator = Math.max(modelPath.lastIndexOf('/'), modelPath.lastIndexOf('\\'));
        const directory = separator >= 0 ? modelPath.substring(0, separator) : '';
        const filename = separator >= 0 ? modelPath.substring(separator + 1) : modelPath;
        const model = filename.replace(/\.gguf$/i, '');
        if (!directory || !model) {
            return;
        }
        await this.preferences.set(STRIGOI_LOCAL_MODELS_DIRECTORY_PREFERENCE, directory, PreferenceScope.User);
        await this.preferences.set(STRIGOI_LLAMA_CPP_MODEL_PATH_PREFERENCE, modelPath, PreferenceScope.User);
        await this.preferences.set(STRIGOI_LOCAL_RUNTIME_MODEL_PREFERENCE, model, PreferenceScope.User);
        await this.updateLanguageModelAliases(model, 'llama.cpp');
    }

    protected async syncAgentMode(): Promise<void> {
        const mode = this.getStrigoiMode();
        this.lastStrigoiMode = mode;
        const presentation: Record<StrigoiMode, { variant: string; text: string; color: string; companion: string; tooltip: string }> = {
            conversation: {
                variant: STRIGOI_CONVERSATION_MODE_ID,
                text: '$(comment-discussion) Modo Firawynix Workspace: Conversa',
                color: '#8be9fd',
                companion: 'Modo conversa — esperando sua próxima ideia.',
                tooltip: 'Modo conversa: responde e pode pesquisar na web, sem trabalhar no workspace. Clique para alternar o modo.'
            },
            plan: {
                variant: STRIGOI_PLAN_MODE_ID,
                text: '$(checklist) Modo Firawynix Workspace: Planejamento',
                color: '#bd93f9',
                companion: 'Modo planejamento — organizando o próximo passo.',
                tooltip: 'Modo planejamento: cria checklist e checkpoints, sem alterar arquivos nem executar comandos. Clique para alternar o modo.'
            },
            agent: {
                variant: STRIGOI_AGENT_MODE_ID,
                text: '$(tools) Modo Firawynix Workspace: Agente',
                color: '#ff79c6',
                companion: 'Modo agente ligado — workspace sob vigilância.',
                tooltip: 'Modo agente: executa somente um item validável do plano por vez. Clique para alternar o modo.'
            }
        };
        const selected = presentation[mode];
        this.setCompanionMessage(selected.companion);
        await this.promptService.updateSelectedVariantId(
            STRIGOI_AGENT_ID,
            STRIGOI_SYSTEM_PROMPT_ID,
            selected.variant
        );
        await this.statusBar.setElement(StrigoiCoreContribution.AGENT_STATUS_BAR_ID, {
            text: selected.text,
            alignment: StatusBarAlignment.RIGHT,
            color: selected.color,
            tooltip: selected.tooltip,
            command: TOGGLE_STRIGOI_AGENT.id,
            priority: 101
        });
        this.updateThinkingToggle();
        if (mode === 'agent') {
            void this.prepareAgentSubagent();
        }
    }

    protected getStrigoiMode(): StrigoiMode {
        const mode = this.preferences.get<string>(STRIGOI_MODE_PREFERENCE, 'conversation');
        return mode === 'plan' || mode === 'agent' ? mode : 'conversation';
    }

    protected async setStrigoiMode(mode: StrigoiMode): Promise<void> {
        await this.preferences.set(STRIGOI_MODE_PREFERENCE, mode, PreferenceScope.User);
    }

    /**
     * Keeps the agent-mode helper model alongside the user's primary GGUF.
     * It is only prepared here; a future orchestrator will decide when to run it.
     */
    protected async prepareAgentSubagent(): Promise<void> {
        if (!this.preferences.get<boolean>(STRIGOI_AGENT_SUBAGENT_AUTO_DOWNLOAD_PREFERENCE, true) || this.agentSubagentDownloadInProgress) {
            return;
        }

        const modelId = this.preferences.get<string>(STRIGOI_AGENT_SUBAGENT_MODEL_PREFERENCE, 'qwen3-4b-q4-k-m');
        let catalog;
        try {
            catalog = await this.localModelCatalog.getCatalog();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'não foi possível consultar o catálogo.';
            this.messages.error(`O subagente não pôde ser preparado: ${message}`);
            return;
        }
        const entry = catalog.models.find(candidate => candidate.id === modelId);
        if (!entry) {
            this.messages.error(`O subagente configurado (${modelId}) não existe no catálogo verificado.`);
            return;
        }

        const directory = await this.resolveLocalModelsDirectory();
        if (!directory) {
            this.messages.warn('Configure primeiro um modelo local principal. Assim o Strigoi saberá onde guardar o subagente do Modo Agente.');
            return;
        }

        try {
            const available = await this.localRuntime.getModels({
                ...this.getLocalRuntimeConfiguration(),
                modelsDirectory: directory
            });
            const installed = available.find(model => this.sameFileName(model.filePath, entry.artifact.file));
            if (installed?.filePath) {
                await this.preferences.set(STRIGOI_AGENT_SUBAGENT_PATH_PREFERENCE, installed.filePath, PreferenceScope.User);
                return;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'não foi possível inspecionar a pasta de modelos.';
            this.messages.warn(`Não foi possível verificar o subagente: ${message}`);
            return;
        }

        this.agentSubagentDownloadInProgress = true;
        this.setCompanionMessage('Preparando o subagente do Modo Agente…');
        try {
            const modelPath = await this.localModelCatalog.downloadModel(entry.id, directory);
            await this.preferences.set(STRIGOI_AGENT_SUBAGENT_PATH_PREFERENCE, modelPath, PreferenceScope.User);
            this.messages.info(`${entry.name} está pronto como subagente local do Modo Firawynix Workspace: Agente.`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'o download não foi concluído.';
            this.messages.error(`Não foi possível preparar o subagente ${entry.name}: ${message}`);
        } finally {
            this.agentSubagentDownloadInProgress = false;
        }
    }

    protected async resolveLocalModelsDirectory(): Promise<string | undefined> {
        const configured = this.preferences.get<string>(STRIGOI_LOCAL_MODELS_DIRECTORY_PREFERENCE, '').trim();
        if (configured) {
            return configured;
        }
        const status = await this.localRuntime.getStatus(this.getLocalRuntimeConfiguration());
        const path = status.detectedModel?.filePath;
        if (!path) {
            return undefined;
        }
        const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
        return separator >= 0 ? path.substring(0, separator) : undefined;
    }

    protected sameFileName(path: string | undefined, expected: string): boolean {
        if (!path) {
            return false;
        }
        const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
        return path.substring(separator + 1).toLocaleLowerCase() === expected.toLocaleLowerCase();
    }

    protected async cycleStrigoiMode(): Promise<void> {
        const modes: readonly StrigoiMode[] = ['conversation', 'plan', 'agent'];
        const current = this.getStrigoiMode();
        await this.setStrigoiMode(modes[(modes.indexOf(current) + 1) % modes.length]);
    }

    protected async initializeThinkingLevel(): Promise<void> {
        const saved = await this.aiSettingsService.getAgentSettings(STRIGOI_AGENT_ID);
        this.thinkingLevel = saved?.reasoning?.level ?? 'off';
        this.updateThinkingToggle();
    }

    protected async cycleThinkingLevel(): Promise<void> {
        const currentIndex = StrigoiCoreContribution.THINKING_LEVELS.indexOf(this.thinkingLevel);
        const nextLevel = StrigoiCoreContribution.THINKING_LEVELS[(currentIndex + 1) % StrigoiCoreContribution.THINKING_LEVELS.length];
        const previousLevel = this.thinkingLevel;
        this.thinkingLevel = nextLevel;
        this.updateThinkingToggle();
        try {
            await this.aiSettingsService.updateAgentSettings(STRIGOI_AGENT_ID, {
                reasoning: { level: nextLevel }
            });
            const labels: Record<ReasoningLevel, string> = {
                off: 'Thinking desativado',
                minimal: 'Thinking mínimo',
                low: 'Thinking baixo',
                medium: 'Thinking médio',
                high: 'Thinking alto',
                auto: 'Thinking automático'
            };
            this.setCompanionMessage(`${labels[nextLevel]} — nível aplicado ao próximo pedido.`);
        } catch (error) {
            this.thinkingLevel = previousLevel;
            this.updateThinkingToggle();
            const message = error instanceof Error ? error.message : 'não foi possível salvar o nível';
            this.messages.error(`Não foi possível alterar o Thinking: ${message}`);
        }
    }

    protected installThinkingToggle(): void {
        const attach = (): void => {
            const host = document.querySelector<HTMLElement>('.theia-ChatInputOptions-left');
            if (!host) {
                return;
            }
            if (!this.thinkingToggle || !this.thinkingToggle.isConnected) {
                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'strigoi-thinking-toggle';
                toggle.addEventListener('click', () => void this.cycleThinkingLevel());

                const label = document.createElement('span');
                label.className = 'strigoi-thinking-toggle-label';
                const track = document.createElement('span');
                track.className = 'strigoi-thinking-toggle-track';
                const thumb = document.createElement('span');
                thumb.className = 'strigoi-thinking-toggle-thumb';
                track.appendChild(thumb);
                toggle.append(label, track);
                host.appendChild(toggle);
                this.thinkingToggle = toggle;
            }
            this.updateThinkingToggle();
            this.synchronizeHomeModelLabel();
        };

        attach();
        if (typeof MutationObserver !== 'undefined' && document.body) {
            this.thinkingToggleObserver = new MutationObserver(attach);
            this.thinkingToggleObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    protected updateThinkingToggle(): void {
        if (!this.thinkingToggle) {
            return;
        }
        const enabled = this.thinkingLevel !== 'off';
        this.thinkingToggle.classList.toggle('is-on', enabled);
        for (const level of StrigoiCoreContribution.THINKING_LEVELS) {
            this.thinkingToggle.classList.remove(`thinking-level-${level}`);
        }
        this.thinkingToggle.classList.add(`thinking-level-${this.thinkingLevel}`);
        this.thinkingToggle.setAttribute('aria-pressed', String(enabled));
        this.thinkingToggle.setAttribute('aria-label', `Alterar nível de Thinking (atual: ${this.thinkingLevel})`);
        this.thinkingToggle.title = `Thinking: ${this.thinkingLevel}. Clique para avançar o nível.`;
        const label = this.thinkingToggle.querySelector<HTMLElement>('.strigoi-thinking-toggle-label');
        if (label) {
            const nextLabel = `Thinking: ${this.thinkingLevel[0].toUpperCase()}${this.thinkingLevel.slice(1)}`;
            if (label.textContent !== nextLabel) {
                label.textContent = nextLabel;
            }
        }
    }

    protected async stopAgentAndReleaseLocalMemory(): Promise<boolean> {
        this.cancelIncompleteChatRequests();
        return this.releaseLocalMemory(false);
    }

    protected cancelIncompleteChatRequests(): void {
        for (const session of this.chatService.getSessions()) {
            for (const request of session.model.getRequests()) {
                if (!request.response.isComplete) {
                    void this.chatService.cancelRequest(session.id, request.id);
                }
            }
        }
    }

    protected async releaseLocalMemory(showNotification: boolean): Promise<boolean> {
        try {
            await this.localRuntime.unloadModel(this.getLocalRuntimeConfiguration());
            await this.refreshLocalRuntimeStatus(false);
            if (showNotification) {
                this.messages.info('Memória da IA local liberada.');
            }
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Não foi possível descarregar o modelo local.';
            if (showNotification) {
                this.messages.error(`Não foi possível liberar a memória da IA local: ${message}`);
            }
            return false;
        }
    }

    protected async ensureStrigoiDefaultAgent(): Promise<void> {
        if (this.preferences.get<boolean>(STRIGOI_AGENT_MIGRATED_PREFERENCE, false)) {
            return;
        }
        const defaultAgent = this.preferences.get<string>(StrigoiCoreContribution.DEFAULT_CHAT_AGENT_PREFERENCE, 'Strigoi');
        if (defaultAgent === 'Coder') {
            await this.preferences.set(
                StrigoiCoreContribution.DEFAULT_CHAT_AGENT_PREFERENCE,
                STRIGOI_AGENT_ID,
                PreferenceScope.User
            );
        }
        await this.preferences.set(STRIGOI_AGENT_MIGRATED_PREFERENCE, true, PreferenceScope.User);
    }

    protected async ensureStrigoiModeDefaults(): Promise<void> {
        if (this.preferences.get<boolean>(STRIGOI_MODE_MIGRATED_PREFERENCE, false)) {
            return;
        }
        const legacyAgentEnabled = this.preferences.get<boolean>(STRIGOI_AGENT_ENABLED_PREFERENCE, false);
        await this.preferences.set(
            STRIGOI_MODE_PREFERENCE,
            legacyAgentEnabled ? 'agent' : 'conversation',
            PreferenceScope.User
        );
        await this.preferences.set(STRIGOI_MODE_MIGRATED_PREFERENCE, true, PreferenceScope.User);
    }

    protected setLocalAiStatus(text: string, color: string, tooltip: string, command = SELECT_LOCAL_AI_MODEL.id): Promise<void> {
        return this.statusBar.setElement(StrigoiCoreContribution.LOCAL_AI_STATUS_BAR_ID, {
            text,
            alignment: StatusBarAlignment.RIGHT,
            color,
            tooltip,
            command,
            priority: 100
        });
    }

    protected setReleaseMemoryStatus(): Promise<void> {
        return this.statusBar.setElement(StrigoiCoreContribution.RELEASE_MEMORY_STATUS_BAR_ID, {
            text: '$(clear-all) Liberar memória',
            alignment: StatusBarAlignment.RIGHT,
            color: '#ffb86c',
            tooltip: 'Cancela respostas em andamento e descarrega o modelo do runtime local. Não fecha outros aplicativos.',
            command: RELEASE_LOCAL_AI_MEMORY.id,
            priority: 99
        });
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(OPEN_STRIGOI_IDE, {
            execute: () => this.openIde()
        });
        commands.registerCommand(OPEN_STRIGOI_HOME, {
            execute: () => this.openHome()
        });
        commands.registerCommand(SHOW_LOCAL_AI_STATUS, {
            execute: () => this.refreshLocalRuntimeStatus(true)
        });
        commands.registerCommand(SELECT_LOCAL_AI_MODEL, {
            execute: () => this.selectLocalModel()
        });
        commands.registerCommand(RELEASE_LOCAL_AI_MEMORY, {
            execute: () => this.releaseLocalMemory(true)
        });
        commands.registerCommand(SHOW_LOCAL_AI_ONBOARDING, {
            execute: () => this.showLocalAiOnboarding()
        });
        commands.registerCommand(DOWNLOAD_VERIFIED_LOCAL_MODEL, {
            execute: () => this.downloadVerifiedLocalModel()
        });
        commands.registerCommand(OPEN_LOCAL_MODEL_CATALOG, {
            execute: () => this.openLocalModelCatalog()
        });
        commands.registerCommand(RECOMMEND_LOCAL_AI_MODEL, {
            execute: () => this.recommendAndInstallLocalModel()
        });
        commands.registerCommand(SHOW_LOCAL_AI_TELEMETRY, {
            execute: () => this.showLocalAiTelemetry()
        });
        commands.registerCommand(TOGGLE_STRIGOI_AGENT, {
            execute: () => this.cycleStrigoiMode()
        });
        commands.registerCommand(SET_STRIGOI_CONVERSATION_MODE, {
            execute: () => this.setStrigoiMode('conversation')
        });
        commands.registerCommand(SET_STRIGOI_PLAN_MODE, {
            execute: () => this.setStrigoiMode('plan')
        });
        commands.registerCommand(SET_STRIGOI_AGENT_MODE, {
            execute: () => this.setStrigoiMode('agent')
        });
        commands.registerCommand(TOGGLE_STRIGOI_WEB_SEARCH, {
            execute: () => this.cycleWebSearchMode()
        });
    }

    registerToolbarItems(registry: TabBarToolbarRegistry): void {
        registry.registerItem({
            id: OPEN_STRIGOI_IDE.id,
            command: OPEN_STRIGOI_IDE.id,
            text: 'IDE',
            tooltip: 'Abrir IDE completa',
            group: 'navigation',
            priority: 10,
            isVisible: widget => widget?.id === ChatViewWidget.ID && this.perspectiveService.getActivePerspectiveId() === STRIGOI_HOME_PERSPECTIVE_ID
        });
        registry.registerItem({
            id: OPEN_LOCAL_MODEL_CATALOG.id,
            command: OPEN_LOCAL_MODEL_CATALOG.id,
            text: 'Modelos',
            tooltip: 'Explorar e instalar modelos locais verificados',
            group: 'navigation',
            priority: 11,
            isVisible: widget => widget?.id === ChatViewWidget.ID && this.perspectiveService.getActivePerspectiveId() !== STRIGOI_HOME_PERSPECTIVE_ID
        });
    }
}
