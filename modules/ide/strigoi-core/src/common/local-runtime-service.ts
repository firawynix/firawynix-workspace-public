export const LOCAL_RUNTIME_SERVICE_PATH = '/services/strigoi/local-runtime';
export const LocalRuntimeService = Symbol('LocalRuntimeService');

export type LocalRuntimeProviderId = 'llama.cpp';
export type LocalRuntimeState = 'ready' | 'missing-model' | 'offline' | 'runtime-unavailable';

export interface LocalModelDetails {
    name: string;
    parameterSize?: string;
    quantizationLevel?: string;
    contextLength?: number;
    filePath?: string;
}

export interface LocalRuntimeConfiguration {
    provider: LocalRuntimeProviderId;
    expectedModel: string;
    llamaServerPath?: string;
    llamaModelPath?: string;
    modelsDirectory?: string;
}

export interface LocalRuntimeStatus {
    provider: LocalRuntimeProviderId;
    state: LocalRuntimeState;
    endpoint?: string;
    expectedModel: string;
    availableModelCount: number;
    detectedModel?: LocalModelDetails;
    isLoaded?: boolean;
    loadedModelMemoryBytes?: number;
    message?: string;
}

/**
 * The browser talks only to this contract. Concrete runtimes remain backend details.
 */
export interface LocalRuntimeService {
    getStatus(configuration: LocalRuntimeConfiguration): Promise<LocalRuntimeStatus>;
    getModels(configuration: LocalRuntimeConfiguration): Promise<LocalModelDetails[]>;
    loadModel(configuration: LocalRuntimeConfiguration): Promise<LocalRuntimeStatus>;
    unloadModel(configuration: LocalRuntimeConfiguration): Promise<void>;
    unloadLastModel(): Promise<void>;
}
