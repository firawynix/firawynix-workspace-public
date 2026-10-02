export const LOCAL_MODEL_CATALOG_SERVICE_PATH = '/services/strigoi/local-model-catalog';
export const LocalModelCatalogService = Symbol('LocalModelCatalogService');

export interface LocalModelArtifact {
    repository: string;
    revision: string;
    file: string;
    sizeBytes: number;
    sha256: string;
}

export interface LocalModelCatalogEntry {
    id: string;
    name: string;
    family: string;
    parameterSize: string;
    quantization: string;
    contextLength: number;
    license: string;
    licenseUrl: string;
    artifact: LocalModelArtifact;
    minimumRamGb: number;
    recommendedVramGb?: number;
}

export interface LocalModelCatalog {
    schemaVersion: 1;
    generatedAt: string;
    models: LocalModelCatalogEntry[];
}

export interface LocalModelDownloadProgress {
    modelId: string;
    receivedBytes: number;
    totalBytes: number;
}

export interface LocalModelCatalogService {
    getCatalog(): Promise<LocalModelCatalog>;
    getHardwareProfile(): Promise<LocalHardwareProfile>;
    downloadModel(modelId: string, destinationDirectory: string): Promise<string>;
}

export interface LocalHardwareProfile {
    cpu: string;
    threads: number;
    ramGb: number;
    gpu: string;
    vramGb: number;
    vramReliable: boolean;
    defaultModelsDirectory: string;
}
