# Aplicativos separados para a Microsoft Store

| Produto | Store ID | Package/Identity/Name | Pacote local |
| --- | --- | --- | --- |
| Firaw - Monitor | `9P60P0V66PN8` | `Firawynix.Firaw-Monitor` | `artifacts/store/standalone/monitor/FirawMonitor_0.1.0.0_x64.msix` |
| Firaw - IDE | `9N968W52SJKR` | `Firawynix.Firaw-IDE` | `artifacts/store/standalone/ide/FirawIDE_0.1.0.0_x64.msix` |
| strigoi | `9P7MM0HKX86L` | `Firawynix.strigoi` | `artifacts/store/standalone/strigoi/Strigoi_0.1.17.0_x64.msix` |

Os três usam o Publisher `CN=1FDE3668-C222-4506-AFE6-E2E425EAECD8` da conta Firawynix. O Monitor contém somente `FirawynixMonitor.exe`; a IDE e o Strigoi contêm suas distribuições Electron independentes. O FirawMerge e o Centrino não entram nos pacotes separados.

O script `../build-standalone-msix.ps1` gera os pacotes sem iniciá-los e sem conexões SSH:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File packaging/store/build-standalone-msix.ps1 -Product Monitor
powershell -NoProfile -ExecutionPolicy Bypass -File packaging/store/build-standalone-msix.ps1 -Product IDE
powershell -NoProfile -ExecutionPolicy Bypass -File packaging/store/build-standalone-msix.ps1 -Product Strigoi -StrigoiDir 'C:\Users\Hugo\Strigoi - Store\original'
```

Os pacotes MSIX são gerados sem assinatura local. O Partner Center valida os pacotes e aplica a assinatura pelo fluxo de publicação. O Strigoi é empacotado da distribuição **original** extraída de `C:\Users\Hugo\Downloads\strigoi-main\strigoi-main\dist\Strigoi-Setup-0.1.17.exe`, preservando o tema Astra roxo, o mascote, as telas Home/IDE e a abertura original. A captura do Monitor usa dados simulados.

Políticas de privacidade públicas: [`privacy-monitor.md`](../../../privacy-monitor.md), [`privacy-ide.md`](../../../privacy-ide.md) e [`privacy-strigoi.md`](../../../privacy-strigoi.md). Os textos das listagens estão em `monitor-listing.md`, `ide-listing.md` e `strigoi-listing.md`.
