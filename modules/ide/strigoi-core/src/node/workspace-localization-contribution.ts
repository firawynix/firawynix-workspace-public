import { injectable } from '@theia/core/shared/inversify';
import { LocalizationContribution, LocalizationRegistry } from '@theia/core/lib/node/i18n/localization-contribution';

/** Theia already ships pt-br strings; expose that locale as a complete selectable pack. */
@injectable()
export class WorkspaceLocalizationContribution implements LocalizationContribution {
    async registerLocalizations(registry: LocalizationRegistry): Promise<void> {
        registry.registerLocalization({
            languageId: 'pt-br',
            languageName: 'Português (Brasil)',
            localizedLanguageName: 'Português (Brasil)',
            languagePack: true,
            translations: {}
        });
    }
}
