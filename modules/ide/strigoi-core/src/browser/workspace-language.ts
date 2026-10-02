import { nls } from '@theia/core';

const english: Record<string, string> = {
    'Explorador': 'Explorer', 'Problemas': 'Problems', 'Testes': 'Tests', 'Saída': 'Output',
    'Menu principal': 'Main menu', 'Buscar arquivos, comandos e símbolos…': 'Search files, commands and symbols…',
    'IA recomendada': 'Recommended AI', 'Modelos locais': 'Local models', 'Idioma / Language': 'Language / Idioma',
    'Nova conversa': 'New chat', 'Histórico de conversas': 'Chat history', 'Assistente': 'Assistant',
    'Conversa': 'Chat', 'Planejar': 'Plan', 'Agente': 'Agent', 'Modo Strigoi': 'Workspace mode',
    'Seu próximo projeto começa aqui.': 'Your next project starts here.',
    'Abra um arquivo, explore o projeto e crie com o Strigoi.': 'Open a file, explore the project and build with Firawynix Workspace.',
    'Abrir pasta': 'Open folder', 'Buscar arquivo': 'Find file', 'Todos os comandos': 'All commands',
    'Trabalhando…': 'Working…', 'Pronto': 'Ready', 'Plano de implementação': 'Implementation plan',
    'Objetivo': 'Goal', 'Concluído': 'Completed', 'Próximo': 'Next', 'Alterações propostas': 'Proposed changes',
    '✓ Aplicado': '✓ Applied', '+ Novo': '+ New', '− Remover': '− Delete', 'Revisar': 'Review',
    'Contexto sob demanda': 'Context on demand', 'Rejeitar': 'Reject', 'Aceitar arquivo': 'Accept file',
    'Desfazer': 'Undo', 'Fechar revisão': 'Close review', 'Vamos construir juntos.': "Let's build together.",
    'Explore uma ideia, planeje a implementação ou peça uma alteração no projeto.': 'Explore an idea, plan the implementation or request a project change.',
    '⌁ Anexe arquivos para dar contexto.': '⌁ Attach files for context.',
    '✓ Revise as alterações antes de aplicar.': '✓ Review changes before applying.',
    'Conversas Firawynix Workspace': 'Firawynix Workspace Chats', 'Recentes': 'Recent',
    'Histórico': 'History', 'Sua primeira conversa aparecerá aqui.': 'Your first chat will appear here.',
    'Iniciar uma nova conversa': 'Start a new chat', '＋ Nova conversa': '＋ New chat',
    'Explorar e instalar modelos locais verificados': 'Explore and install verified local models',
    'Configurações': 'Settings', 'Abrir configurações': 'Open settings', 'Conversas': 'Chats',
    'agora': 'now', 'Arquivo ativo enviado ao FirawMerge. Escolha a outra versão para comparar.': 'Active file sent to FirawMerge. Choose the other version to compare.',
    'FirawMerge aberto para comparação local.': 'FirawMerge opened for local comparison.'
};

export function uiText(portuguese: string): string {
    return nls.locale === 'en' ? english[portuguese] ?? portuguese : portuguese;
}
