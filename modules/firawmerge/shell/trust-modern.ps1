$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Execute este passo como administrador para confiar na assinatura local da extensão.'
}
$certificateFile = Join-Path $PSScriptRoot 'build\FirawMergeContext.cer'
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new((Resolve-Path -LiteralPath $certificateFile).Path)
$target = 'Cert:\LocalMachine\TrustedPeople\' + $certificate.Thumbprint
if (-not (Test-Path -LiteralPath $target)) {
  Import-Certificate -FilePath $certificateFile -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
}
Write-Output ('Certificado FirawMerge confiável para o computador: ' + $certificate.Thumbprint)
