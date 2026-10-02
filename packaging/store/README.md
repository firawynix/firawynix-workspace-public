# Pacote para a Microsoft Store

Compile os três aplicativos da edição pública. Em seguida execute `build-msix.ps1` com os executáveis gerados. O script inclui apenas os binários do Monitor, IDE e FirawMerge, produz um MSIX x64 e informa o SHA-256.

O padrão `Firawynix.Workspace.Preview` serve apenas para verificar o empacotamento. Para submissão, reserve **Firawynix Workspace** no Partner Center e copie exatamente os campos **Package/Identity Name** e **Publisher**. Gere novamente com `-IdentityName` e `-Publisher`; o MSIX deve ser associado ao aplicativo reservado. Faça os testes de instalação e certificação com essa versão final antes de enviar.

Exemplo: `powershell -NoProfile -ExecutionPolicy Bypass -File packaging/store/build-msix.ps1 -IdentityName 'NOME_DO_PARTNER_CENTER' -Publisher 'CN=EDITOR_DO_PARTNER_CENTER'`

O MSIX de prévia é gerado sem assinatura local. Ele não é instalável como versão final. A publicação e a assinatura final são feitas pelo fluxo da Microsoft Store.
