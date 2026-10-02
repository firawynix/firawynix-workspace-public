/**
 * Generated using theia-extension-generator
 */
import { ContainerModule } from '@theia/core/shared/inversify';
import { Agent, AIVariableContribution, bindToolProvider } from '@theia/ai-core/lib/common';
import { ChatAgent } from '@theia/ai-chat/lib/common';
import { ChatRequestParser } from '@theia/ai-chat/lib/common/chat-request-parser';
import { CommandContribution, PreferenceContribution } from '@theia/core';
import { FrontendApplicationContribution, RemoteConnectionProvider, ServiceConnectionProvider, WidgetFactory } from '@theia/core/lib/browser';
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { PerspectiveContribution } from '@theia/core/lib/browser/perspective-service';
import { LOCAL_RUNTIME_SERVICE_PATH, LocalRuntimeService } from '../common/local-runtime-service';
import { LOCAL_MODEL_CATALOG_SERVICE_PATH, LocalModelCatalogService } from '../common/local-model-catalog-service';
import { LLAMA_CPP_LANGUAGE_MODELS_MANAGER_PATH, LlamaCppLanguageModelsManager } from '../common/llama-cpp-language-models-manager';
import { strigoiPreferenceSchema } from './strigoi-preferences';
import { StrigoiAgent } from './strigoi-agent';
import { StrigoiChatRequestParser } from './strigoi-chat-request-parser';
import { StrigoiDocumentAttachmentContribution } from './strigoi-document-attachment-contribution';
import { StrigoiCoreContribution } from './strigoi-core-contribution';
import { StrigoiHomeSessionsWidget } from './strigoi-home-sessions-widget';
import { LlamaCppFrontendApplicationContribution } from './llama-cpp-frontend-application-contribution';
import { WEB_SEARCH_SERVICE_PATH, WebSearchService } from '../common/web-search-service';
import { WebSearchToolProvider } from './web-search-tool-provider';
import { StrigoiIdeContribution } from './strigoi-ide-contribution';
import { StrigoiIdeWelcome } from './strigoi-ide-welcome';
import { StrigoiSkillRouter } from './skill-router';
import { ExtensionsSourceContribution } from '@theia/vsx-registry/lib/browser/extensions-source-contribution';
import { SalesforceExtensionsContribution } from './salesforce-extensions-contribution';
import { StrigoiWorkspaceFileListTool, StrigoiWorkspaceRootsTool, StrigoiWorkspaceToolContribution } from './workspace-tool-orchestration';
import { ChatWelcomeMessageProvider } from '@theia/ai-chat-ui/lib/browser/chat-tree-view';
import { WorkspaceFunctionScope } from '@theia/ai-ide/lib/browser/workspace-functions';
import { StrigoiWorkspaceScope } from './strigoi-workspace-scope';
import { StrigoiFileContentTool } from './strigoi-file-content-tool';
import { FIRAWMERGE_SERVICE_PATH, FirawMergeService } from '../common/firawmerge-service';
import '../../src/browser/style/empty-editor.css';
import '../../src/browser/style/strigoi-ide.css';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {

    bind(PreferenceContribution).toConstantValue({ schema: strigoiPreferenceSchema });
    rebind(WorkspaceFunctionScope).to(StrigoiWorkspaceScope).inSingletonScope();
    bind(StrigoiFileContentTool).toSelf().inSingletonScope();

    bind(StrigoiAgent).toSelf().inSingletonScope();
    bind(StrigoiChatRequestParser).toSelf().inSingletonScope();
    rebind(ChatRequestParser).toService(StrigoiChatRequestParser);
    bind(StrigoiDocumentAttachmentContribution).toSelf().inSingletonScope();
    bind(AIVariableContribution).toService(StrigoiDocumentAttachmentContribution);
    bind(StrigoiSkillRouter).toSelf().inSingletonScope();
    bind(SalesforceExtensionsContribution).toSelf().inSingletonScope();
    bind(ExtensionsSourceContribution).toService(SalesforceExtensionsContribution);
    bind(Agent).toService(StrigoiAgent);
    bind(ChatAgent).toService(StrigoiAgent);
    bindToolProvider(WebSearchToolProvider, bind);
    bind(StrigoiWorkspaceFileListTool).toSelf().inSingletonScope();
    bind(StrigoiWorkspaceRootsTool).toSelf().inSingletonScope();
    bind(StrigoiWorkspaceToolContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(StrigoiWorkspaceToolContribution);
    bind(StrigoiIdeContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(StrigoiIdeContribution);
    bind(CommandContribution).toService(StrigoiIdeContribution);
    bind(ChatWelcomeMessageProvider).to(StrigoiIdeWelcome).inSingletonScope();

    bind(StrigoiCoreContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(StrigoiCoreContribution);
    bind(FrontendApplicationContribution).toService(StrigoiCoreContribution);
    bind(LlamaCppFrontendApplicationContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(LlamaCppFrontendApplicationContribution);
    bind(TabBarToolbarContribution).toService(StrigoiCoreContribution);
    bind(PerspectiveContribution).toService(StrigoiCoreContribution);
    bind(StrigoiHomeSessionsWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: StrigoiHomeSessionsWidget.ID,
        createWidget: () => context.container.get(StrigoiHomeSessionsWidget)
    }));
    bind(LocalRuntimeService).toDynamicValue(ctx => {
        const provider = ctx.container.get<ServiceConnectionProvider>(RemoteConnectionProvider);
        return provider.createProxy<LocalRuntimeService>(LOCAL_RUNTIME_SERVICE_PATH);
    }).inSingletonScope();
    bind(LocalModelCatalogService).toDynamicValue(ctx => {
        const provider = ctx.container.get<ServiceConnectionProvider>(RemoteConnectionProvider);
        return provider.createProxy<LocalModelCatalogService>(LOCAL_MODEL_CATALOG_SERVICE_PATH);
    }).inSingletonScope();
    bind(FirawMergeService).toDynamicValue(ctx => {
        const provider = ctx.container.get<ServiceConnectionProvider>(RemoteConnectionProvider);
        return provider.createProxy<FirawMergeService>(FIRAWMERGE_SERVICE_PATH);
    }).inSingletonScope();
    bind(LlamaCppLanguageModelsManager).toDynamicValue(ctx => {
        const provider = ctx.container.get<ServiceConnectionProvider>(RemoteConnectionProvider);
        return provider.createProxy<LlamaCppLanguageModelsManager>(LLAMA_CPP_LANGUAGE_MODELS_MANAGER_PATH);
    }).inSingletonScope();
    bind(WebSearchService).toDynamicValue(ctx => {
        const provider = ctx.container.get<ServiceConnectionProvider>(RemoteConnectionProvider);
        return provider.createProxy<WebSearchService>(WEB_SEARCH_SERVICE_PATH);
    }).inSingletonScope();
});
