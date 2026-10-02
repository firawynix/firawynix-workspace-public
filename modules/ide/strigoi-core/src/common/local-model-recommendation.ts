import { LocalHardwareProfile, LocalModelCatalogEntry } from './local-model-catalog-service';

export interface LocalModelRecommendation {
    model?: LocalModelCatalogEntry;
    reason: string;
    execution: 'GPU' | 'CPU';
}

/** Prefer coding models that fit RAM, then use VRAM to describe acceleration. */
export function recommendLocalModel(
    profile: LocalHardwareProfile,
    models: readonly LocalModelCatalogEntry[]
): LocalModelRecommendation {
    const viable = models.filter(model => model.minimumRamGb <= profile.ramGb);
    const preferredIds = [
        'qwen3-coder-30b-a3b-instruct-q8-0',
        'qwen2.5-coder-7b-instruct-q4-k-m',
        'qwen2.5-coder-3b-instruct-q4-k-m',
        'qwen3-14b-q4-k-m',
        'qwen3-4b-q4-k-m'
    ];
    const model = preferredIds.map(id => viable.find(candidate => candidate.id === id)).find(Boolean)
        ?? viable.sort((left, right) => right.artifact.sizeBytes - left.artifact.sizeBytes)[0];
    if (!model) {
        return { execution: 'CPU', reason: 'Nenhum modelo verificado do catálogo cabe no mínimo de RAM informado. Use um modelo menor manualmente.', model: undefined };
    }
    const gpu = profile.vramReliable && profile.vramGb >= (model.recommendedVramGb ?? Number.POSITIVE_INFINITY);
    const execution = gpu ? 'GPU' : 'CPU';
    const reason = `${model.name} exige no mínimo ${model.minimumRamGb} GB de RAM. Este computador tem ${profile.ramGb} GB de RAM, `
        + `${profile.threads} threads e ${profile.vramReliable ? `${profile.vramGb} GB de VRAM` : 'VRAM não confirmada'}. `
        + `Execução estimada: ${execution}; o llama.cpp decide a aceleração real.`;
    return { model, execution, reason };
}
