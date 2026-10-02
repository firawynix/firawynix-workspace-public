# Strigoi

IDE desktop local-first para desenvolvimento assistido por IA, construída sobre Eclipse Theia e Electron. O runtime local atual usa llama.cpp, com seleção automática de CPU, Vulkan ou ROCm quando disponível.

## Primeiro incremento

- editor Monaco, explorer, terminal e busca;
- chat e recursos de IA do Theia;
- runtime llama.cpp próprio, sem cobrança por token;
- tema Strigoi Astra, com fallback Dracula;
- modos Conversa, Planejar e Agente;
- catálogo de modelos locais, pesquisa web controlada e revisão de alterações por change set;
- base para o navegador colaborativo planejado.

## Pré-requisitos

- Windows 10/11;
- Node.js 22 ou 24;
- npm 10 ou superior;
- Visual Studio 2026 com o workload **Desktop development with C++** para o build desktop.

## Desenvolvimento

```powershell
npm install
npm run check:runtime
npm run build:preview
npm run start:preview
```

O primeiro build baixa dependências, o Electron, extensões declarativas de linguagem e o plugin Dracula. Pode levar alguns minutos.

A prévia abre em `http://127.0.0.1:3100`. A versão desktop usa `npm run build` e `npm start`.

## Instalador Windows

Para gerar o instalador NSIS de desenvolvimento (x64), execute:

```powershell
npm run package:windows
```

O artefato é criado em `dist/Strigoi-Setup-<versão>.exe`. A build local ainda não é assinada; o aviso do Windows é esperado até a etapa de homologação e assinatura.

## Modelo local

Os arquivos GGUF ficam na pasta `models/` do diretório escolhido pelo usuário. O instalador e o catálogo configuram o caminho do runtime automaticamente; arquivos de modelo não são versionados.

Os binários nativos do llama.cpp, modelos, builds e perfis locais também ficam fora do repositório. O instalador distribuído contém os runtimes necessários para execução no Windows.

## Planejamento

As especificações ficam em `.specs/` e os documentos visuais em `docs/planning/`. Consulte também `docs/ONBOARDING-IA-LOCAL.md` e `docs/VALIDACAO-M1.md`.

## Site oficial

A landing page pública fica em [`website/`](website/), em React + Vite, pronta para Cloudflare Pages. Use `website` como diretório raiz, `npm run build` como comando de build e `dist` como diretório de saída.
