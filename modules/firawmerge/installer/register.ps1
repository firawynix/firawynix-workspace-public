param([Parameter(Mandatory)][string]$AppDir)
$ErrorActionPreference = 'Stop'
$appPath = Join-Path $AppDir 'FirawMerge.exe'
$support = Join-Path $AppDir 'support'
if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) { throw 'FirawMerge.exe não encontrado.' }

# O menu clássico funciona em Windows 10 e 11 sem instalar uma extensão.
$settings = 'HKCU:\Software\Firawynix\FirawMerge'
New-Item -Path $settings -Force | Out-Null
Set-ItemProperty -Path $settings -Name AppPath -Value $appPath
foreach ($verb in @(
  @{ Path = 'HKCU:\Software\Classes\Directory\shell\FirawMerge'; Argument = '%1' },
  @{ Path = 'HKCU:\Software\Classes\*\shell\FirawMerge'; Argument = '%1' },
  @{ Path = 'HKCU:\Software\Classes\Directory\Background\shell\FirawMerge'; Argument = '%V' }
)) {
  New-Item -Path $verb.Path -Force -Value 'FirawMerge' | Out-Null
  Set-ItemProperty -Path $verb.Path -Name Icon -Value ('"{0}",0' -f $appPath)
  Set-ItemProperty -Path $verb.Path -Name MultiSelectModel -Value 'Single'
  New-Item -Path (Join-Path $verb.Path 'command') -Force -Value ('"{0}" "{1}"' -f $appPath, $verb.Argument) | Out-Null
}

if ([Environment]::OSVersion.Version.Build -lt 22000) { return }
$cerPath = Join-Path $support 'FirawMergeContext.cer'
$msixPath = Join-Path $support 'FirawMerge.Context.msix'
$dllPath = Join-Path $AppDir 'FirawExplorerCommand.dll'
if (-not (Test-Path -LiteralPath $cerPath) -or -not (Test-Path -LiteralPath $msixPath) -or -not (Test-Path -LiteralPath $dllPath)) {
  throw 'Arquivos do menu moderno ausentes.'
}
$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($cerPath)
if ($cert.Thumbprint -ne '668BEF56480FCA8EB1B0BC3B102A6A9CEC554CC4') { throw 'Certificado inesperado.' }
$x86Dll = Join-Path $support 'x86\FirawExplorerCommand.dll'
if (-not [Environment]::Is64BitOperatingSystem) {
  if (-not (Test-Path -LiteralPath $x86Dll)) { throw 'Extensão x86 ausente.' }
  Copy-Item -LiteralPath $x86Dll -Destination $dllPath -Force
}
$signature = Get-AuthenticodeSignature -LiteralPath $msixPath
if ($signature.SignerCertificate.Thumbprint -ne $cert.Thumbprint) { throw 'Assinatura do pacote não corresponde ao certificado.' }
$trusted = 'Cert:\LocalMachine\TrustedPeople\' + $cert.Thumbprint
if (-not (Test-Path -LiteralPath $trusted)) {
  Import-Certificate -FilePath $cerPath -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
}
if ((Get-AuthenticodeSignature -LiteralPath $msixPath).Status -ne 'Valid') { throw 'Assinatura inválida do pacote do menu.' }
$existing = Get-AppxPackage -Name 'Firawynix.FirawMerge.ContextV2'
if ($existing) { $existing | Remove-AppxPackage -ErrorAction Stop }
Add-AppxPackage -Path $msixPath -ExternalLocation $AppDir -ErrorAction Stop
