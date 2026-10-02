import React = require('@theia/core/shared/react');
import { injectable } from '@theia/core/shared/inversify';
import { ChatWelcomeMessageProvider } from '@theia/ai-chat-ui/lib/browser/chat-tree-view';
import { uiText } from './workspace-language';

/** An IDE-only introduction. Model availability remains owned by the native provider. */
@injectable()
export class StrigoiIdeWelcome implements ChatWelcomeMessageProvider {
    readonly priority = -10;
    renderWelcomeMessage(): React.ReactNode {
        return React.createElement('div', { className: 'strigoi-ide-welcome' },
            React.createElement('h2', undefined, uiText('Vamos construir juntos.')),
            React.createElement('p', undefined, uiText('Explore uma ideia, planeje a implementação ou peça uma alteração no projeto.')),
            React.createElement('div', undefined, uiText('⌁ Anexe arquivos para dar contexto.')),
            React.createElement('div', undefined, uiText('✓ Revise as alterações antes de aplicar.'))
        );
    }
}
