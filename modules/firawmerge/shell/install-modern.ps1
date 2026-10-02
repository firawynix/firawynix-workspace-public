$ErrorActionPreference = 'Stop'
$certificateFile = Join-Path $PSScriptRoot 'build\FirawMergeContext.cer'
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new((Resolve-Path -LiteralPath $certificateFile).Path)
if (-not (Test-Path -LiteralPath ('Cert:\LocalMachine\TrustedPeople\' + $certificate.Thumbprint))) {
  throw 'A assinatura local ainda não está confiável no computador. Execute trust-modern.ps1 como administrador.'
}
$package = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'build\FirawMerge.Context.msix')).Path
$external = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\release\win-unpacked')).Path
if (-not (Test-Path -LiteralPath (Join-Path $external 'FirawMerge.exe'))) {
  throw 'FirawMerge.exe não foi encontrado.'
}
if (-not (Test-Path -LiteralPath (Join-Path $external 'FirawExplorerCommand.dll'))) {
  throw 'FirawExplorerCommand.dll não foi encontrada ao lado do aplicativo.'
}
$settingsKey = 'HKCU:\Software\Firawynix\FirawMerge'
New-Item -Path $settingsKey -Force | Out-Null
Set-ItemProperty -Path $settingsKey -Name AppPath -Value (Join-Path $external 'FirawMerge.exe')
$existing = Get-AppxPackage -Name 'Firawynix.FirawMerge.ContextV2'
if ($existing) { $existing | Remove-AppxPackage -ErrorAction Stop }
Add-AppxPackage -Path $package -ExternalLocation $external -ErrorAction Stop
$installed = Get-AppxPackage -Name 'Firawynix.FirawMerge.ContextV2'
if (-not $installed) { throw 'O pacote do menu principal não foi registrado.' }
$installed | Select-Object Name,Version,PackageFullName
