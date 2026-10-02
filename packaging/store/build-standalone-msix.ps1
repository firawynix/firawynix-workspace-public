<#
.SYNOPSIS
  Empacota o Monitor, a IDE ou o Strigoi em um MSIX x64 independente para a Microsoft Store.
.DESCRIPTION
  Não inicia o aplicativo e não faz conexões SSH. Usa as identidades oficiais
  reservadas no Partner Center para cada produto.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File packaging/store/build-standalone-msix.ps1 -Product Monitor
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File packaging/store/build-standalone-msix.ps1 -Product IDE -IdentityName Firawynix.FirawIDE
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File packaging/store/build-standalone-msix.ps1 -Product Strigoi -StrigoiDir 'C:\Users\Hugo\Strigoi - Store\original'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Monitor', 'IDE', 'Strigoi')]
    [string]$Product,
    [string]$IdentityName = '',
    [string]$Publisher = 'CN=1FDE3668-C222-4506-AFE6-E2E425EAECD8',
    [string]$Version = '',
    [string]$MonitorExe = '',
    [string]$IdeDir = '',
    [string]$StrigoiDir = '',
    [string]$StrigoiIcon = ''
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$products = @{
    Monitor = @{
        Identity = 'Firawynix.Firaw-Monitor'
        AppId = 'FirawMonitor'
        DisplayName = 'Firaw - Monitor'
        Description = 'Monitor de serviços Linux por conexões SSH configuradas pelo usuário'
        PackageName = 'FirawMonitor'
        Icon = 'modules\monitor\assets\app.png'
    }
    IDE = @{
        Identity = 'Firawynix.Firaw-IDE'
        AppId = 'FirawIDE'
        DisplayName = 'Firaw - IDE'
        Description = 'IDE para projetos locais com recursos opcionais de IA'
        PackageName = 'FirawIDE'
        Icon = 'modules\ide\build\strigoi-icon.png'
    }
    Strigoi = @{
        Identity = 'Firawynix.strigoi'
        AppId = 'Strigoi'
        DisplayName = 'strigoi'
        Description = 'Ambiente local para conversa, planejamento e desenvolvimento com IA opcional'
        PackageName = 'Strigoi'
        Icon = ''
    }
}
$settings = $products[$Product]
if (-not $IdentityName) { $IdentityName = $settings.Identity }
if (-not $Version) { $Version = if ($Product -eq 'Strigoi') { '0.1.17.0' } else { '0.1.0.0' } }
if (-not $MonitorExe) { $MonitorExe = Join-Path $workspace 'modules\monitor\dist\FirawynixMonitor.exe' }
if (-not $IdeDir) { $IdeDir = Join-Path $workspace 'modules\ide\dist\win-unpacked' }
if ($Product -eq 'Strigoi') {
    if (-not $StrigoiDir) { throw 'Informe -StrigoiDir com a distribuição original extraída do instalador Strigoi.' }
    $StrigoiDir = (Resolve-Path -LiteralPath $StrigoiDir).Path
    if (-not $StrigoiIcon) { $StrigoiIcon = Join-Path $StrigoiDir 'resources\app\electron-app\resources\strigoi-icon.png' }
}

if ($IdentityName -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]{2,49}$') { throw 'IdentityName inválido.' }
if ($Publisher -notmatch '^CN=.+') { throw 'Publisher inválido.' }
if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw 'Version deve ter quatro números.' }
if ($Product -eq 'Monitor' -and -not (Test-Path -LiteralPath $MonitorExe -PathType Leaf)) {
    throw "Executável do Monitor ausente: $MonitorExe"
}
if ($Product -eq 'IDE' -and -not (Test-Path -LiteralPath (Join-Path $IdeDir 'Strigoi.exe') -PathType Leaf)) {
    throw "Executável da IDE ausente: $IdeDir\Strigoi.exe"
}
if ($Product -eq 'Strigoi' -and -not (Test-Path -LiteralPath (Join-Path $StrigoiDir 'Strigoi.exe') -PathType Leaf)) {
    throw "Executável do Strigoi ausente: $StrigoiDir\Strigoi.exe"
}
if ($Product -eq 'Strigoi') {
    $splash = Join-Path $StrigoiDir 'resources\app\electron-app\resources\splash.html'
    $theme = Join-Path $StrigoiDir 'resources\app\plugins\strigoi.astra-theme\package.json'
    if (-not (Test-Path -LiteralPath $splash -PathType Leaf) -or
        -not (Test-Path -LiteralPath $theme -PathType Leaf) -or
        (Get-Content -LiteralPath $splash -Raw) -notmatch 'strigoi-mascot-v1\.png' -or
        (Get-Content -LiteralPath $theme -Raw) -notmatch 'Strigoi Astra') {
        throw 'A distribuição informada não corresponde à identidade visual original do Strigoi.'
    }
}

$makeAppx = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter makeappx.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\makeappx\.exe$' } |
    Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $makeAppx) { throw 'Instale o Windows SDK com MakeAppx.exe x64.' }

$output = Join-Path $workspace ('artifacts\store\standalone\' + $Product.ToLowerInvariant())
$stage = Join-Path $output 'stage'
$workspaceFull = [System.IO.Path]::GetFullPath($workspace).TrimEnd('\') + '\'
$stageFull = [System.IO.Path]::GetFullPath($stage)
if (-not $stageFull.StartsWith($workspaceFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Diretório temporário fora do workspace.'
}
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage 'Assets') -Force | Out-Null

if ($Product -eq 'Monitor') {
    Copy-Item -LiteralPath $MonitorExe -Destination (Join-Path $stage 'FirawynixMonitor.exe')
    $executable = 'FirawynixMonitor.exe'
} else {
    $sourceDir = if ($Product -eq 'Strigoi') { $StrigoiDir } else { $IdeDir }
    Get-ChildItem -LiteralPath $sourceDir -Force | Copy-Item -Destination $stage -Recurse -Force
    $executable = 'Strigoi.exe'
}

$icon = if ($Product -eq 'Strigoi') { $StrigoiIcon } else { Join-Path $workspace $settings.Icon }
$python = Get-Command python.exe -ErrorAction Stop | Select-Object -ExpandProperty Source
& $python (Join-Path $PSScriptRoot 'make-assets.py') $icon (Join-Path $stage 'Assets')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar os logotipos.' }

$values = @{
    '@IDENTITY@' = $IdentityName
    '@PUBLISHER@' = $Publisher
    '@VERSION@' = $Version
    '@APP_ID@' = $settings.AppId
    '@EXECUTABLE@' = $executable
    '@DISPLAY_NAME@' = $settings.DisplayName
    '@DESCRIPTION@' = $settings.Description
}
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'StandaloneManifest.template.xml') -Raw
foreach ($name in $values.Keys) {
    $manifest = $manifest.Replace($name, [System.Security.SecurityElement]::Escape($values[$name]))
}
[xml]$manifestXml = $manifest
$manifestXml.Save((Join-Path $stage 'AppxManifest.xml'))

$forbidden = Get-ChildItem -LiteralPath $stage -Recurse -File | Where-Object {
    $_.Name -match '(?i)^\.env|^servers\.json$|^profiles\.json$|^workspace\.json$|\.(pem|key|pfx|p12|db|sqlite3?)$'
}
if ($forbidden) { throw 'O pacote contém arquivo privado.' }

$package = Join-Path $output ("{0}_{1}_x64.msix" -f $settings.PackageName, $Version)
if (Test-Path -LiteralPath $package) { Remove-Item -LiteralPath $package -Force }
$packOutput = & $makeAppx pack /d $stage /p $package /o 2>&1
if ($LASTEXITCODE -ne 0) {
    $packOutput | Select-Object -Last 20 | Write-Output
    throw 'MakeAppx não conseguiu criar o MSIX.'
}
$hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash
Write-Output "MSIX=$package"
Write-Output "SHA256=$hash"
Write-Output "IDENTITY=$IdentityName"
Write-Output "PUBLISHER=$Publisher"
if ($IdentityName.EndsWith('.Preview')) {
    Write-Warning 'Identidade provisória: gere o pacote final com o Package/Identity/Name oficial do Partner Center.'
}
