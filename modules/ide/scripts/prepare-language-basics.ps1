$ErrorActionPreference = 'Stop'
# Declarative language extensions from the MIT-licensed VS Code source release.
# No extension executable or language server is installed by this script.
$sourceBase = 'https://raw.githubusercontent.com/microsoft/vscode/1.104.0'
$pluginRoot = Join-Path $PSScriptRoot '..\plugins'
foreach ($extension in @('typescript-basics', 'javascript', 'json', 'css', 'html', 'python')) {
    $destination = Join-Path $pluginRoot "vscode.$extension"
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    $manifestPath = Join-Path $destination 'package.json'
    if (!(Test-Path -LiteralPath $manifestPath)) {
        Invoke-WebRequest "$sourceBase/extensions/$extension/package.json" -OutFile $manifestPath
    }
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    $relativeFiles = @('package.nls.json')
    $relativeFiles += @($manifest.contributes.languages | ForEach-Object { $_.configuration } | Where-Object { $_ })
    $relativeFiles += @($manifest.contributes.grammars | ForEach-Object { $_.path })
    $relativeFiles += @($manifest.contributes.snippets | ForEach-Object { $_.path })
    foreach ($relative in ($relativeFiles | Sort-Object -Unique)) {
        $relative = $relative -replace '^\./', ''
        $target = Join-Path $destination $relative
        if (!(Test-Path -LiteralPath $target)) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
            Invoke-WebRequest "$sourceBase/extensions/$extension/$relative" -OutFile $target
        }
    }
    $license = Join-Path $destination 'LICENSE.txt'
    if (!(Test-Path -LiteralPath $license)) { Invoke-WebRequest "$sourceBase/LICENSE.txt" -OutFile $license }
    Write-Output "Language assets ready: vscode.$extension"
}
