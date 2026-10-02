import { ConnectionHandler, RpcConnectionHandler } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { ContainerModule } from '@theia/core/shared/inversify';
import { LOCAL_RUNTIME_SERVICE_PATH, LocalRuntimeService } from '../common/local-runtime-service';
import { LOCAL_MODEL_CATALOG_SERVICE_PATH, LocalModelCatalogService } from '../common/local-model-catalog-service';
import { LocalRuntimeShutdownContribution } from './local-runtime-shutdown-contribution';
import { LlamaCppRuntimeProvider } from './llama-cpp-runtime-provider';
import { LocalRuntimeServiceImpl } from './local-runtime-service';
import { LocalModelCatalogServiceImpl } from './local-model-catalog-service';
import { LlamaCppLanguageModelsManagerImpl } from './llama-cpp-language-models-manager';
import { LlamaCppLanguageModelsManager, LLAMA_CPP_LANGUAGE_MODELS_MANAGER_PATH } from '../common/llama-cpp-language-models-manager';
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { WEB_SEARCH_SERVICE_PATH, WebSearchService } from '../common/web-search-service';
import { WebSearchServiceImpl } from './web-search-service';
import { FIRAWMERGE_SERVICE_PATH, FirawMergeService } from '../common/firawmerge-service';
import { FirawMergeServiceImpl } from './firawmerge-service';
import { LocalizationContribution } from '@theia/core/lib/node/i18n/localization-contribution';
import { WorkspaceLocalizationContribution } from './workspace-localization-contribution';

const llamaCppConnectionModule = ConnectionContainerModule.create(({ bind }) => {
    bind(LlamaCppLanguageModelsManagerImpl).toSelf().inSingletonScope();
    bind(LlamaCppLanguageModelsManager).toService(LlamaCppLanguageModelsManagerImpl);
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(LLAMA_CPP_LANGUAGE_MODELS_MANAGER_PATH, () => ctx.container.get(LlamaCppLanguageModelsManager))
    ).inSingletonScope();
});

export default new ContainerModule(bind => {
    bind(WebSearchServiceImpl).toSelf().inSingletonScope();
    bind(WebSearchService).toService(WebSearchServiceImpl);
    bind(ConnectionContainerModule).toConstantValue(llamaCppConnectionModule);
    bind(LlamaCppRuntimeProvider).toSelf().inSingletonScope();
    bind(LocalRuntimeServiceImpl).toSelf().inSingletonScope();
    bind(LocalRuntimeService).toService(LocalRuntimeServiceImpl);
    bind(LocalModelCatalogServiceImpl).toSelf().inSingletonScope();
    bind(LocalModelCatalogService).toService(LocalModelCatalogServiceImpl);
    bind(FirawMergeServiceImpl).toSelf().inSingletonScope();
    bind(FirawMergeService).toService(FirawMergeServiceImpl);
    bind(WorkspaceLocalizationContribution).toSelf().inSingletonScope();
    bind(LocalizationContribution).toService(WorkspaceLocalizationContribution);
    bind(LocalRuntimeShutdownContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(LocalRuntimeShutdownContribution);
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(LOCAL_RUNTIME_SERVICE_PATH, () => ctx.container.get(LocalRuntimeService))
    ).inSingletonScope();
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(LOCAL_MODEL_CATALOG_SERVICE_PATH, () => ctx.container.get(LocalModelCatalogService))
    ).inSingletonScope();
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(FIRAWMERGE_SERVICE_PATH, () => ctx.container.get(FirawMergeService))
    ).inSingletonScope();
    bind(ConnectionHandler).toDynamicValue(ctx =>
        new RpcConnectionHandler(WEB_SEARCH_SERVICE_PATH, () => ctx.container.get(WebSearchService))
    ).inSingletonScope();
});
