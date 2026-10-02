import { LanguageModelRegistry, LanguageModelStatus } from '@theia/ai-core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { LlamaCppLanguageModelsManager } from '../common/llama-cpp-language-models-manager';
import { LocalRuntimeConfiguration } from '../common/local-runtime-service';
import { LlamaCppLanguageModel } from './llama-cpp-language-model';
import { LlamaCppRuntimeProvider } from './llama-cpp-runtime-provider';

@injectable()
export class LlamaCppLanguageModelsManagerImpl implements LlamaCppLanguageModelsManager {

    protected configuration: LocalRuntimeConfiguration | undefined;
    protected registeredModelId: string | undefined;

    @inject(LanguageModelRegistry)
    protected readonly languageModelRegistry: LanguageModelRegistry;

    @inject(LlamaCppRuntimeProvider)
    protected readonly runtime: LlamaCppRuntimeProvider;

    async setConfiguration(configuration: LocalRuntimeConfiguration): Promise<void> {
        this.configuration = configuration;
        const id = `llama.cpp/${configuration.expectedModel}`;
        if (this.registeredModelId && this.registeredModelId !== id) {
            this.languageModelRegistry.removeLanguageModels([this.registeredModelId]);
        }
        this.registeredModelId = id;
        const runtimeStatus = await this.runtime.getStatus(configuration);
        const status: LanguageModelStatus = runtimeStatus.state === 'ready'
            ? { status: 'ready' }
            : { status: 'unavailable', message: runtimeStatus.message };
        const existing = await this.languageModelRegistry.getLanguageModel(id);
        if (existing instanceof LlamaCppLanguageModel) {
            await this.languageModelRegistry.patchLanguageModel<LlamaCppLanguageModel>(id, { status });
            return;
        }
        this.languageModelRegistry.addLanguageModels([new LlamaCppLanguageModel(
            id,
            configuration.expectedModel,
            status,
            () => this.configuration ?? configuration,
            this.runtime
        )]);
    }
}
