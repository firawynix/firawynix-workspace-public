import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core';
import { LlamaCppLanguageModelsManager } from '../common/llama-cpp-language-models-manager';
import { LocalRuntimeConfiguration } from '../common/local-runtime-service';
import {
    STRIGOI_LLAMA_CPP_MODEL_PATH_PREFERENCE,
    STRIGOI_LLAMA_CPP_SERVER_PATH_PREFERENCE,
    STRIGOI_LOCAL_MODELS_DIRECTORY_PREFERENCE,
    STRIGOI_LOCAL_RUNTIME_MODEL_PREFERENCE
} from './strigoi-preferences';

@injectable()
export class LlamaCppFrontendApplicationContribution implements FrontendApplicationContribution {

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    @inject(LlamaCppLanguageModelsManager)
    protected readonly manager: LlamaCppLanguageModelsManager;

    onStart(): void {
        this.preferences.ready.then(() => {
            void this.syncConfiguration();
            this.preferences.onPreferenceChanged(event => {
                if ([
                    STRIGOI_LOCAL_RUNTIME_MODEL_PREFERENCE,
                    STRIGOI_LLAMA_CPP_SERVER_PATH_PREFERENCE,
                    STRIGOI_LLAMA_CPP_MODEL_PATH_PREFERENCE,
                    STRIGOI_LOCAL_MODELS_DIRECTORY_PREFERENCE
                ].includes(event.preferenceName)) {
                    void this.syncConfiguration();
                }
            });
        });
    }

    protected syncConfiguration(): Promise<void> {
        const configuration: LocalRuntimeConfiguration = {
            provider: 'llama.cpp',
            expectedModel: this.preferences.get<string>(STRIGOI_LOCAL_RUNTIME_MODEL_PREFERENCE, 'qwen2.5-coder-7b-instruct-q4-k-m'),
            llamaServerPath: this.preferences.get<string>(STRIGOI_LLAMA_CPP_SERVER_PATH_PREFERENCE, '') || undefined,
            llamaModelPath: this.preferences.get<string>(STRIGOI_LLAMA_CPP_MODEL_PATH_PREFERENCE, '') || undefined,
            modelsDirectory: this.preferences.get<string>(STRIGOI_LOCAL_MODELS_DIRECTORY_PREFERENCE, '') || undefined
        };
        return this.manager.setConfiguration(configuration);
    }
}
