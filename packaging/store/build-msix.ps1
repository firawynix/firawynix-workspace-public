<#
.SYNOPSIS
  Empacota Monitor, IDE e FirawMerge em um MSIX x64 para a Microsoft Store.
.DESCRIPTION
  Usa a identidade oficial do Firawynix Workspace reservada no Partner Center.
#>
[CmdletBinding()]
param(
    [string]$IdentityName = 'Firawynix.FirawynixWorkspace',
    [string]$Publisher = 'CN=1FDE3668-C222-4506-AFE6-E2E425EAECD8',
    [string]$Version = '0.1.0.0',
    [string]$MonitorExe = '',
    [string]$MergeExe = '',
    [string]$IdeDir = ''
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
if (-not $MonitorExe) { $MonitorExe = Join-Path $workspace 'modules\monitor\dist\FirawynixMonitor.exe' }
if (-not $MergeExe) { $MergeExe = Join-Path $workspace 'modules\firawmerge\release\FirawMerge-0.3.0-x64.exe' }
if (-not $IdeDir) { $IdeDir = Join-Path $workspace 'modules\ide\dist\win-unpacked' }
foreach ($file in @($MonitorExe, $MergeExe, (Join-Path $IdeDir 'Strigoi.exe'))) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Executável ausente: $file" }
}
if ($IdentityName -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]{2,49}$') { throw 'IdentityName inválido.' }
if ($Publisher -notmatch '^CN=.+') { throw 'Publisher inválido.' }
if ($Version -notmatch '^\d+\.\d+\.\d+\.\d+$') { throw 'Version deve ter quatro números.' }

$makeAppx = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter makeappx.exe -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\makeappx\.exe$' } | Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $makeAppx) { throw 'Instale o Windows SDK com MakeAppx.exe x64.' }

$output = Join-Path $workspace 'artifacts\store'
$stage = Join-Path $output 'stage'
$workspaceFull = [System.IO.Path]::GetFullPath($workspace).TrimEnd('\') + '\'
$stageFull = [System.IO.Path]::GetFullPath($stage)
if (-not $stageFull.StartsWith($workspaceFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Diretório temporário fora do workspace.'
}
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $stage 'Assets'), (Join-Path $stage 'tools\Strigoi') -Force | Out-Null
Copy-Item -LiteralPath $MonitorExe -Destination (Join-Path $stage 'FirawynixMonitor.exe')
Copy-Item -LiteralPath $MergeExe -Destination (Join-Path $stage 'tools\FirawMerge.exe')
Get-ChildItem -LiteralPath $IdeDir -Force | Copy-Item -Destination (Join-Path $stage 'tools\Strigoi') -Recurse -Force

# Os logotipos são gerados do ícone público do Monitor, sem recursos locais.
$icon = Join-Path $workspace 'modules\monitor\assets\app.png'
$python = Get-Command python.exe -ErrorAction Stop | Select-Object -ExpandProperty Source
$assetScript = Join-Path $PSScriptRoot 'make-assets.py'
& $python $assetScript $icon (Join-Path $stage 'Assets')
if ($LASTEXITCODE -ne 0) { throw 'Falha ao preparar os logotipos.' }

$escapedName = [System.Security.SecurityElement]::Escape($IdentityName)
$escapedPublisher = [System.Security.SecurityElement]::Escape($Publisher)
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'AppxManifest.template.xml') -Raw
$manifest = $manifest.Replace('@IDENTITY@', $escapedName).Replace('@PUBLISHER@', $escapedPublisher).Replace('@VERSION@', $Version)
[xml]$manifestXml = $manifest
$manifestXml.Save((Join-Path $stage 'AppxManifest.xml'))

$forbidden = Get-ChildItem -LiteralPath $stage -Recurse -File | Where-Object {
    $_.Name -match '(?i)^\.env|^servers\.json$|^profiles\.json$|^workspace\.json$|\.(pem|key|pfx|p12|db|sqlite3?)$'
}
if ($forbidden) { throw 'O pacote contém arquivo privado ou componente removido.' }

$package = Join-Path $output ("FirawynixWorkspace_{0}_x64.msix" -f $Version)
if (Test-Path -LiteralPath $package) { Remove-Item -LiteralPath $package -Force }
& $makeAppx pack /d $stage /p $package /o
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx não conseguiu criar o MSIX.' }
$hash = (Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash
Write-Output "MSIX=$package"
Write-Output "SHA256=$hash"
Write-Output "IDENTITY=$IdentityName"
if ($IdentityName.EndsWith('.Preview')) { Write-Warning 'Identidade provisória: gere o MSIX final com os valores oficiais do Partner Center.' }
