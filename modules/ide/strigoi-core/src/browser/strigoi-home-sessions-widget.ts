import { ChatService, ChatSessionMetadata } from '@theia/ai-chat';
import { AI_CHAT_HOME, AI_CHAT_OPEN_SESSION } from '@theia/ai-chat-ui/lib/browser/chat-view-commands';
import { ChatSessionListService } from '@theia/ai-ide/lib/browser/chat-session-list-service';
import { CommandRegistry } from '@theia/core';
import { CommonCommands } from '@theia/core/lib/browser';
import { Widget } from '@theia/core/lib/browser/widgets/widget';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { uiText } from './workspace-language';

/**
 * Navigation owned by the Strigoi Home. It deliberately renders the same
 * session data as Theia's AI session view without inheriting its IDE chrome.
 */
@injectable()
export class StrigoiHomeSessionsWidget extends Widget {

    static readonly ID = 'strigoi-home-sessions';

    @inject(ChatSessionListService)
    protected readonly sessions: ChatSessionListService;

    @inject(ChatService)
    protected readonly chatService: ChatService;

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    @postConstruct()
    protected init(): void {
        this.id = StrigoiHomeSessionsWidget.ID;
        this.title.label = uiText('Conversas Firawynix Workspace');
        this.title.caption = uiText('Conversas Firawynix Workspace');
        this.title.closable = false;
        this.addClass('strigoi-home-sessions');
        const sessionListener = this.sessions.onStateChanged(() => this.render());
        const activeSessionListener = this.chatService.onSessionEvent(event => {
            if (event.type === 'activeChange') {
                this.render();
            }
        });
        this.disposed.connect(() => {
            sessionListener.dispose();
            activeSessionListener.dispose();
        });
        this.render();
    }

    protected render(): void {
        const content = document.createElement('div');
        content.className = 'strigoi-home-sessions-content';

        const header = document.createElement('div');
        header.className = 'strigoi-home-sessions-header';
        const brand = document.createElement('span');
        brand.className = 'strigoi-home-sessions-brand';
        brand.textContent = 'Firawynix Workspace';
        const newChat = document.createElement('button');
        newChat.className = 'strigoi-home-new-chat';
        newChat.type = 'button';
        newChat.title = uiText('Iniciar uma nova conversa');
        newChat.textContent = uiText('＋ Nova conversa');
        newChat.addEventListener('click', () => void this.commands.executeCommand(AI_CHAT_HOME.id));
        const models = document.createElement('button');
        models.className = 'strigoi-home-model-catalog';
        models.type = 'button';
        models.title = uiText('Explorar e instalar modelos locais verificados');
        models.innerHTML = '<span class="codicon codicon-server-environment" aria-hidden="true"></span><span>Modelos locais</span>';
        models.addEventListener('click', () => void this.commands.executeCommand('strigoi.local-ai.catalog'));
        header.append(brand, newChat, models);

        const scroll = document.createElement('nav');
        scroll.className = 'strigoi-home-sessions-scroll';
        scroll.setAttribute('aria-label', uiText('Conversas'));
        const { active, restored } = this.sessions.getSections();
        const uniqueSessions = [...active, ...restored]
            .filter((session, index, sessions) => sessions.findIndex(candidate => candidate.sessionId === session.sessionId) === index)
            .sort((left, right) => right.saveDate - left.saveDate);
        const recent = uniqueSessions.slice(0, 4);
        const history = uniqueSessions.slice(4);
        this.appendSection(scroll, uiText('Recentes'), recent);
        this.appendSection(scroll, uiText('Histórico'), history);
        if (uniqueSessions.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'strigoi-home-sessions-empty';
            empty.textContent = uiText('Sua primeira conversa aparecerá aqui.');
            scroll.appendChild(empty);
        }

        const settings = document.createElement('button');
        settings.className = 'strigoi-home-settings';
        settings.type = 'button';
        settings.title = uiText('Abrir configurações');
        settings.innerHTML = '<span class="codicon codicon-settings-gear" aria-hidden="true"></span><span>Configurações</span>';
        settings.addEventListener('click', () => void this.commands.executeCommand(CommonCommands.OPEN_PREFERENCES.id));

        content.append(header, scroll, settings);
        this.node.replaceChildren(content);
    }

    protected appendSection(parent: HTMLElement, label: string, sessions: readonly ChatSessionMetadata[]): void {
        if (sessions.length === 0) {
            return;
        }
        const section = document.createElement('section');
        section.className = 'strigoi-home-sessions-section';
        section.setAttribute('aria-label', label);
        const heading = document.createElement('h2');
        heading.textContent = label;
        section.appendChild(heading);
        sessions.slice(0, 24).forEach(session => section.appendChild(this.createSessionButton(session)));
        parent.appendChild(section);
    }

    protected createSessionButton(session: ChatSessionMetadata): HTMLButtonElement {
        const button = document.createElement('button');
        button.className = 'strigoi-home-session';
        button.type = 'button';
        button.title = session.title;
        if (this.chatService.getActiveSession()?.id === session.sessionId) {
            button.classList.add('strigoi-home-session-active');
            button.setAttribute('aria-current', 'true');
        }
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-comment-discussion strigoi-home-session-icon';
        icon.setAttribute('aria-hidden', 'true');
        const title = document.createElement('span');
        title.className = 'strigoi-home-session-title';
        title.textContent = session.title;
        const time = document.createElement('span');
        time.className = 'strigoi-home-session-time';
        time.textContent = this.formatTime(session.saveDate);
        button.append(icon, title, time);
        button.addEventListener('click', () => void this.commands.executeCommand(AI_CHAT_OPEN_SESSION.id, session.sessionId));
        return button;
    }

    protected formatTime(saveDate: number): string {
        const elapsedMinutes = Math.max(0, Math.floor((Date.now() - saveDate) / 60_000));
        if (elapsedMinutes < 1) {
            return uiText('agora');
        }
        if (elapsedMinutes < 60) {
            return `${elapsedMinutes} min`;
        }
        const elapsedHours = Math.floor(elapsedMinutes / 60);
        if (elapsedHours < 24) {
            return `${elapsedHours} h`;
        }
        return `${Math.floor(elapsedHours / 24)} d`;
    }
}
