import { LocalRuntimeConfiguration } from './local-runtime-service';

export const LLAMA_CPP_LANGUAGE_MODELS_MANAGER_PATH = '/services/strigoi/llama-cpp/language-model-manager';
export const LlamaCppLanguageModelsManager = Symbol('LlamaCppLanguageModelsManager');

export interface LlamaCppLanguageModelsManager {
    setConfiguration(configuration: LocalRuntimeConfiguration): Promise<void>;
}
