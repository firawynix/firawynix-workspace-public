import { inject, injectable } from '@theia/core/shared/inversify';
import { LocalModelDetails, LocalRuntimeConfiguration, LocalRuntimeService, LocalRuntimeStatus } from '../common/local-runtime-service';
import { LlamaCppRuntimeProvider } from './llama-cpp-runtime-provider';

@injectable()
export class LocalRuntimeServiceImpl implements LocalRuntimeService {

    @inject(LlamaCppRuntimeProvider)
    protected readonly llamaCpp: LlamaCppRuntimeProvider;

    async getStatus(configuration: LocalRuntimeConfiguration): Promise<LocalRuntimeStatus> {
        return this.llamaCpp.getStatus(configuration);
    }

    async getModels(configuration: LocalRuntimeConfiguration): Promise<LocalModelDetails[]> {
        return this.llamaCpp.getModels(configuration);
    }

    async loadModel(configuration: LocalRuntimeConfiguration): Promise<LocalRuntimeStatus> {
        return this.llamaCpp.loadModel(configuration);
    }

    async unloadModel(configuration: LocalRuntimeConfiguration): Promise<void> {
        await this.llamaCpp.unloadModel();
    }

    async unloadLastModel(): Promise<void> {
        await this.llamaCpp.unloadModel();
    }
}
