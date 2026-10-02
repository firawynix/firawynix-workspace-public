import { BackendApplicationContribution } from '@theia/core/lib/node';
import { inject, injectable } from '@theia/core/shared/inversify';
import { LocalRuntimeService } from '../common/local-runtime-service';

/** Stops only the llama.cpp process started by this Strigoi instance. */
@injectable()
export class LocalRuntimeShutdownContribution implements BackendApplicationContribution {

    @inject(LocalRuntimeService)
    protected readonly localRuntime: LocalRuntimeService;

    async onStop(): Promise<void> {
        try {
            await this.localRuntime.unloadLastModel();
        } catch (error) {
            console.warn('Strigoi não conseguiu descarregar o modelo local ao fechar.', error);
        }
    }
}
