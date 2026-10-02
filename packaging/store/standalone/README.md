# Aplicativos separados para a Microsoft Store

| Produto | Store ID | Package/Identity/Name | Pacote local |
| --- | --- | --- | --- |
| Firaw - Monitor | `9P60P0V66PN8` | `Firawynix.Firaw-Monitor` | `artifacts/store/standalone/monitor/FirawMonitor_0.1.0.0_x64.msix` |
| Firaw - IDE | `9N968W52SJKR` | `Firawynix.Firaw-IDE` | `artifacts/store/standalone/ide/FirawIDE_0.1.0.0_x64.msix` |

Ambos usam o Publisher `CN=1FDE3668-C222-4506-AFE6-E2E425EAECD8` da conta Firawynix. O Monitor contém somente `FirawynixMonitor.exe`; a IDE contém somente a distribuição Electron da IDE. O FirawMerge e o Centrino não entram nos pacotes separados.

O script `../build-standalone-msix.ps1` gera os pacotes sem iniciá-los e sem conexões SSH:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packaging/store/build-standalone-msix.ps1 -Product Monitor
powershell -NoProfile -ExecutionPolicy Bypass -File packaging/store/build-standalone-msix.ps1 -Product IDE
```

Os pacotes MSIX são gerados sem assinatura local. O Partner Center valida os pacotes e aplica a assinatura pelo fluxo de publicação. A captura do Monitor usa dados simulados. Antes de enviar a IDE para certificação, adicione uma captura real dela com projeto de exemplo e sem caminhos privados.

Políticas de privacidade públicas: [`privacy-monitor.md`](../../../privacy-monitor.md) e [`privacy-ide.md`](../../../privacy-ide.md). Os textos das listagens estão em `monitor-listing.md` e `ide-listing.md`.
