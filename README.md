# Firawynix Workspace

Edição pública para Windows que reúne o Monitor, a Firawynix Workspace IDE e o FirawMerge. As ferramentas locais podem abrir em janelas auxiliares. O Monitor inicia sem servidores configurados e só usa SSH quando o usuário adiciona uma conexão.

## Projetos

- `modules/monitor`: painel desktop e opções de conexão SSH.
- `modules/ide`: IDE desktop com idiomas português brasileiro e inglês e ferramentas locais de IA.
- `modules/firawmerge`: comparação local de arquivos e pastas.

## Compilação

O Monitor usa Python 3.13 e `modules/monitor/scripts/build.ps1`. A IDE usa Node.js 22 e `npm run build` seguido de `npx electron-builder --win dir --x64`. O FirawMerge usa Node.js e `npx electron-builder --win portable --x64 --config packaging/workspace-portable.cjs`. O script `modules/monitor/scripts/package-workspace.ps1` monta um pacote portátil e um instalador tradicional. Para preparar o MSIX, use `packaging/store/build-msix.ps1` após compilar os três componentes.

## Dados privados

Configurações locais, senhas, chaves, bancos, logs e artefatos compilados não são versionados. O exemplo de servidores está vazio. O histórico deste repositório começa nesta edição pública.

A [política de privacidade](privacy-policy.md) descreve os dados locais e os recursos opcionais de rede desta edição.

## Site local

A página de apresentação fica em [`site/`](site/README.md), com barra inferior fixa e links para a Microsoft Store e o repositório FIRAWYNIX. Ela pode ser aberta localmente em `http://127.0.0.1:4176/` sem conectar aos servidores do Monitor.

## Edições separadas

O Monitor e a IDE também têm [pacotes MSIX independentes](packaging/store/standalone/README.md) para os produtos **Firaw - Monitor** e **Firaw - IDE** na Microsoft Store. As políticas específicas estão em [Monitor](privacy-monitor.md) e [IDE](privacy-ide.md).
