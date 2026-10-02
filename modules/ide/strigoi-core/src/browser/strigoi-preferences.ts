import { PreferenceSchema, PreferenceScope } from '@theia/core';

export const STRIGOI_AGENT_ENABLED_PREFERENCE = 'strigoi.agent.enabled';
export const STRIGOI_AGENT_MIGRATED_PREFERENCE = 'strigoi.agent.migrated';
export const STRIGOI_MODE_PREFERENCE = 'strigoi.mode';
export const STRIGOI_MODE_MIGRATED_PREFERENCE = 'strigoi.mode.migrated';
export const STRIGOI_COMPANION_ENABLED_PREFERENCE = 'strigoi.companion.enabled';
export const STRIGOI_LOCAL_RUNTIME_PREFERENCE = 'strigoi.localRuntime.provider';
export const STRIGOI_LOCAL_RUNTIME_MIGRATED_PREFERENCE = 'strigoi.localRuntime.migrated';
export const STRIGOI_LOCAL_RUNTIME_MODEL_PREFERENCE = 'strigoi.localRuntime.selectedModel';
export const STRIGOI_LLAMA_CPP_SERVER_PATH_PREFERENCE = 'strigoi.localRuntime.llamaCpp.serverPath';
export const STRIGOI_LLAMA_CPP_MODEL_PATH_PREFERENCE = 'strigoi.localRuntime.llamaCpp.modelPath';
export const STRIGOI_LOCAL_MODELS_DIRECTORY_PREFERENCE = 'strigoi.localRuntime.modelsDirectory';
export const STRIGOI_WEB_SEARCH_MODE_PREFERENCE = 'strigoi.webSearch.mode';
export const STRIGOI_AGENT_SUBAGENT_MODEL_PREFERENCE = 'strigoi.agent.subagent.model';
export const STRIGOI_AGENT_SUBAGENT_PATH_PREFERENCE = 'strigoi.agent.subagent.path';
export const STRIGOI_AGENT_SUBAGENT_AUTO_DOWNLOAD_PREFERENCE = 'strigoi.agent.subagent.autoDownload';

export const strigoiPreferenceSchema: PreferenceSchema = {
    properties: {
        [STRIGOI_AGENT_ENABLED_PREFERENCE]: {
            type: 'boolean',
            default: false,
            scope: PreferenceScope.User,
            description: 'Compatibilidade com versões anteriores. Use “Modo Strigoi” para escolher Conversa, Planejamento ou Agente.'
        },
        [STRIGOI_AGENT_MIGRATED_PREFERENCE]: {
            type: 'boolean',
            default: false,
            scope: PreferenceScope.User,
            description: 'Registra a migração do agente padrão para o Strigoi.'
        },
        [STRIGOI_MODE_PREFERENCE]: {
            type: 'string',
            enum: ['conversation', 'plan', 'agent'],
            default: 'conversation',
            scope: PreferenceScope.User,
            description: 'Modo Strigoi: Conversa responde diretamente; Planejamento cria um checklist sem alterar arquivos; Agente executa um item validável por vez.'
        },
        [STRIGOI_MODE_MIGRATED_PREFERENCE]: {
            type: 'boolean',
            default: false,
            scope: PreferenceScope.User,
            description: 'Registra a migração do modo antigo de agente para os modos do Strigoi.'
        },
        [STRIGOI_COMPANION_ENABLED_PREFERENCE]: {
            type: 'boolean',
            default: false,
            scope: PreferenceScope.User,
            description: 'Compatibilidade com o painel antigo de mascote, oculto no Firawynix Workspace.'
        },
        [STRIGOI_LOCAL_RUNTIME_PREFERENCE]: {
            type: 'string',
            enum: ['llama.cpp'],
            default: 'llama.cpp',
            scope: PreferenceScope.User,
            description: 'Runtime local de IA. O runtime próprio llama.cpp é o padrão do Strigoi.'
        },
        [STRIGOI_LOCAL_RUNTIME_MIGRATED_PREFERENCE]: {
            type: 'boolean',
            default: false,
            scope: PreferenceScope.User,
            description: 'Registra a migração única do runtime padrão para o llama.cpp.'
        },
        [STRIGOI_LOCAL_RUNTIME_MODEL_PREFERENCE]: {
            type: 'string',
            default: 'qwen2.5-coder-7b-instruct-q4-k-m',
            scope: PreferenceScope.User,
            description: 'Identificador do modelo GGUF selecionado para o runtime próprio do Strigoi.'
        },
        [STRIGOI_LLAMA_CPP_SERVER_PATH_PREFERENCE]: {
            type: 'string',
            default: '',
            scope: PreferenceScope.User,
            description: 'Caminho opcional para o executável llama-server do runtime próprio do Strigoi.'
        },
        [STRIGOI_LLAMA_CPP_MODEL_PATH_PREFERENCE]: {
            type: 'string',
            default: '',
            scope: PreferenceScope.User,
            description: 'Caminho opcional para o arquivo GGUF usado pelo runtime próprio.'
        },
        [STRIGOI_LOCAL_MODELS_DIRECTORY_PREFERENCE]: {
            type: 'string',
            default: '',
            scope: PreferenceScope.User,
            description: 'Diretório de modelos GGUF baixados diretamente pelo Strigoi.'
        },
        [STRIGOI_WEB_SEARCH_MODE_PREFERENCE]: {
            type: 'string',
            enum: ['off', 'auto', 'on'],
            default: 'auto',
            scope: PreferenceScope.User,
            description: 'Pesquisa na web: desligada, automática ou sempre disponível para o agente.'
        },
        [STRIGOI_AGENT_SUBAGENT_MODEL_PREFERENCE]: {
            type: 'string',
            default: 'qwen3-4b-q4-k-m',
            scope: PreferenceScope.User,
            description: 'Modelo leve reservado para futuras tarefas auxiliares do Modo Strigoi: Agente.'
        },
        [STRIGOI_AGENT_SUBAGENT_PATH_PREFERENCE]: {
            type: 'string',
            default: '',
            scope: PreferenceScope.User,
            description: 'Caminho do modelo leve preparado para tarefas auxiliares do Modo Strigoi: Agente.'
        },
        [STRIGOI_AGENT_SUBAGENT_AUTO_DOWNLOAD_PREFERENCE]: {
            type: 'boolean',
            default: true,
            scope: PreferenceScope.User,
            description: 'Baixa automaticamente o subagente leve verificado ao ativar o Modo Strigoi: Agente.'
        }
    }
};
