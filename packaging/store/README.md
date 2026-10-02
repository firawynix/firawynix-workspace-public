# Pacote para a Microsoft Store

Compile os três aplicativos da edição pública. Em seguida execute `build-msix.ps1` com os executáveis gerados. O script inclui apenas os binários do Monitor, IDE e FirawMerge, produz um MSIX x64 e informa o SHA-256.

O nome **Firawynix Workspace** está reservado no Partner Center, com Store ID `9NHPH2BRCXML`. O script usa a identidade oficial `Firawynix.FirawynixWorkspace` e o Publisher informado no cadastro. Faça os testes de instalação e certificação com o pacote final antes de enviar.

Comando: `powershell -NoProfile -ExecutionPolicy Bypass -File packaging/store/build-msix.ps1`

O MSIX é gerado sem assinatura local. A publicação e a assinatura final são feitas pelo fluxo da Microsoft Store.
