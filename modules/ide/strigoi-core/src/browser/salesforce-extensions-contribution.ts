import React = require('@theia/core/shared/react');
import { Emitter, Event, nls } from '@theia/core';
import { TreeElement } from '@theia/core/lib/browser/source-tree';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ExtensionsSourceContribution, SearchContext, SearchResult } from '@theia/vsx-registry/lib/browser/extensions-source-contribution';
import { VSXExtensionsModel } from '@theia/vsx-registry/lib/browser/vsx-extensions-model';
import { StrigoiSkillRouter } from './skill-router';

const SALESFORCE_EXTENSION_PACK_ID = 'salesforce.salesforcedx-vscode-expanded';

/**
 * Makes Strigoi-owned skills and the curated official Salesforce pack visible
 * beside regular Open VSX entries. Third-party code is never bundled or
 * installed automatically: the person explicitly invokes its card action.
 */
@injectable()
export class SalesforceExtensionsContribution implements ExtensionsSourceContribution {
    readonly type = 'skill';
    readonly displayName = nls.localizeByDefault('Strigoi Skills & Salesforce');
    readonly searchToken = '@skills';
    readonly priority = -10;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @inject(StrigoiSkillRouter)
    protected readonly skillRouter: StrigoiSkillRouter;

    @inject(VSXExtensionsModel)
    protected readonly extensionsModel: VSXExtensionsModel;

    *resolveInstalled(): Iterable<TreeElement> {
        yield this.createNativeSkillsCard(this.skillRouter.getPacks()[0]?.description ?? 'Skills Salesforce instaladas.');
    }

    async resolveRecommended(): Promise<Iterable<TreeElement>> {
        const recommendations: TreeElement[] = [this.createNativeSkillsCard(
            'Apex, SOQL/SOSL, LWC, DX, Industries/OmniStudio e Agentforce. O roteador ativa somente o contexto relevante.'
        )];

        // Resolve through the same model that powers the Open VSX results. The
        // resulting VSXExtension owns the real install button, consent dialogs,
        // progress reporting and extension-pack dependency deployment.
        const extension = await this.extensionsModel.resolve(SALESFORCE_EXTENSION_PACK_ID);
        if (!extension.installed) {
            recommendations.push(extension);
        }
        return recommendations;
    }

    *resolveSearchResults(query: string, _context: SearchContext): Iterable<SearchResult> {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        const title = 'Strigoi Salesforce & Agentforce Skills';
        const description = 'Pacote nativo de skills para Core, Industries e Agentforce.';
        const searchableText = `${title} ${description} strigoi.salesforce`.toLocaleLowerCase();
        if (!normalizedQuery || searchableText.includes(normalizedQuery)) {
            yield { element: this.createNativeSkillsCard(description), searchableText };
        }
    }

    protected createNativeSkillsCard(description: string): TreeElement {
        return {
            id: 'strigoi-salesforce-strigoi.salesforce',
            render: () => React.createElement('article', { className: 'strigoi-salesforce-extension-card' },
                React.createElement('div', { className: 'strigoi-salesforce-extension-card-heading' },
                    React.createElement('span', { className: 'codicon codicon-cloud' }),
                    React.createElement('strong', undefined, 'Strigoi Salesforce & Agentforce Skills')
                ),
                React.createElement('p', undefined, description),
                React.createElement('footer', undefined,
                    React.createElement('span', { className: 'strigoi-salesforce-extension-badge' }, 'Nativo · instalado'),
                    React.createElement('span', { className: 'strigoi-salesforce-extension-installed' }, 'Ativo')
                )
            )
        };
    }
}
