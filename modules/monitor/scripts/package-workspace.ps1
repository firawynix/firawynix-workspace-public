<#
.SYNOPSIS
    Monta o pacote portátil Windows do Monitor + FirawMerge + Firawynix Workspace IDE.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-workspace.ps1 -SkipMonitorBuild

#>
param(
    [string]$PythonVersion = "3.13",
    [switch]$SkipMonitorBuild,
    [string]$MergeExe = "",
    [string]$StrigoiDir = ""
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $root '..\..')).Path

if (-not $SkipMonitorBuild) {
    & (Join-Path $PSScriptRoot "build.ps1") -PythonVersion $PythonVersion -SkipTests
    if ($LASTEXITCODE -ne 0) { throw "A compilação do monitor falhou." }
}

$monitorExe = Join-Path $root "dist\FirawynixMonitor.exe"
if (-not (Test-Path -LiteralPath $monitorExe -PathType Leaf)) {
    throw "Monitor não compilado: $monitorExe"
}

if (-not $MergeExe) {
    $mergeProject = Join-Path $workspaceRoot "modules\firawmerge"
    $mergePackage = Get-Content -LiteralPath (Join-Path $mergeProject "package.json") -Raw | ConvertFrom-Json
    $MergeExe = Join-Path $mergeProject "release\FirawMerge-$($mergePackage.version)-x64.exe"
}
if (-not (Test-Path -LiteralPath $MergeExe -PathType Leaf)) {
    throw "Compile o FirawMerge portátil x64 ou passe -MergeExe: $MergeExe"
}

if (-not $StrigoiDir) {
    $StrigoiDir = Join-Path $workspaceRoot "modules\ide\dist\win-unpacked"
}
if (-not (Test-Path -LiteralPath (Join-Path $StrigoiDir "Strigoi.exe") -PathType Leaf)) {
    throw "Compile o Strigoi com 'npm run package:windows' ou passe -StrigoiDir: $StrigoiDir"
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bundle = Join-Path $root "dist\FirawynixWorkspace-Windows-x64-$stamp"
New-Item -ItemType Directory -Path $bundle -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $bundle "tools\Strigoi") -Force | Out-Null

Copy-Item -LiteralPath $monitorExe -Destination (Join-Path $bundle "FirawynixMonitor.exe")
Copy-Item -LiteralPath (Join-Path $root "servers.example.json") -Destination $bundle
Copy-Item -LiteralPath $MergeExe -Destination (Join-Path $bundle "tools\FirawMerge.exe")
Get-ChildItem -LiteralPath $StrigoiDir -Force | Copy-Item -Destination (Join-Path $bundle "tools\Strigoi") -Recurse -Force

@'
FIRAWYNIX WORKSPACE — WINDOWS x64

1. Extraia toda a pasta. Abra FirawynixMonitor.exe (não mova apenas o .exe).
2. Na primeira execução, o app cria uma configuração vazia em %APPDATA%\FirawynixMonitor.
   Ele não abre conexões automaticamente.
3. Quando quiser configurar SSH, use Conexões: senha, chave, agente, VPN, túnel ou proxy.
4. Em Ferramentas locais, escolha arquivos/pastas para o FirawMerge ou abra uma pasta
   na Firawynix Workspace IDE. Os dois já acompanham o pacote na pasta tools.
Senhas SSH devem ficar no Gerenciador de Credenciais do Windows ou ser pedidas ao conectar.
'@ | Set-Content -LiteralPath (Join-Path $bundle "LEIA-ME.txt") -Encoding UTF8

$zip = "$bundle.zip"
Compress-Archive -LiteralPath $bundle -DestinationPath $zip -CompressionLevel Optimal
Write-Output "Pacote pronto: $zip"

$nsis = (Get-Command makensis.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)
if (-not $nsis) {
    $nsisCache = Join-Path $env:LOCALAPPDATA "electron-builder\Cache"
    if (Test-Path -LiteralPath $nsisCache) {
        $nsis = Get-ChildItem -LiteralPath $nsisCache -Filter "makensis.exe" -Recurse -File |
            Select-Object -First 1 -ExpandProperty FullName
    }
}
if ($nsis) {
    $installer = Join-Path $root "dist\FirawynixWorkspace-Setup-x64-$stamp.exe"
    & $nsis "/DBUNDLE_DIR=$bundle" "/DOUT_FILE=$installer" (Join-Path $root "packaging\workspace.nsi")
    if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o instalador NSIS." }
    Write-Output "Instalador pronto: $installer"
} else {
    Write-Warning "makensis.exe não encontrado; o pacote ZIP portátil está pronto."
}
