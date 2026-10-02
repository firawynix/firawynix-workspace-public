$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$packageRoot = Join-Path $root 'package'
$builtDll = Join-Path $root 'build\FirawExplorerCommand.dll'
$external = Join-Path $root '..\release\win-unpacked'
$stage = Join-Path $root 'build\package-stage'
$package = Join-Path $root 'build\FirawMerge.Context.msix'
$thumbprint = (Get-Content -LiteralPath (Join-Path $root 'build\cert-thumbprint.txt') -Raw).Trim()
$certificate = Get-Item -LiteralPath ('Cert:\CurrentUser\My\' + $thumbprint)
if (-not $certificate.HasPrivateKey) { throw 'O certificado de assinatura não tem chave privada.' }
if (-not (Test-Path -LiteralPath $builtDll)) { throw 'Compile a DLL com shell\build.cmd primeiro.' }
$kit = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64'
$makeAppx = Join-Path $kit 'MakeAppx.exe'
$signTool = Join-Path $kit 'signtool.exe'
if (-not (Test-Path -LiteralPath $makeAppx) -or -not (Test-Path -LiteralPath $signTool)) {
  throw 'Windows SDK com MakeAppx e SignTool não encontrado.'
}
if (-not (Test-Path -LiteralPath (Join-Path $external 'FirawMerge.exe'))) { throw 'Gere o aplicativo antes do pacote.' }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $packageRoot 'AppxManifest.xml') -Destination (Join-Path $stage 'AppxManifest.xml') -Force
Copy-Item -LiteralPath $builtDll -Destination (Join-Path $external 'FirawExplorerCommand.dll') -Force
Copy-Item -LiteralPath (Join-Path $packageRoot 'Assets') -Destination (Join-Path $external 'Assets') -Recurse -Force
& $makeAppx pack /d $stage /p $package /o /nv
if ($LASTEXITCODE -ne 0) { throw 'Falha ao empacotar a extensão.' }
& $signTool sign /fd SHA256 /sha1 $thumbprint /s My $package
if ($LASTEXITCODE -ne 0) { throw 'Falha ao assinar a extensão.' }
Write-Output $package
