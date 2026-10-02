$ErrorActionPreference = 'Stop'

$minimumNodeMajor = 22
$minimumOllamaVersion = [version]'0.32.12'
$nodeVersion = (& node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])

if ($nodeMajor -lt $minimumNodeMajor) {
    throw "Strigoi requer Node.js 22 ou superior. Versão encontrada: $nodeVersion"
}

$ollamaCommand = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollamaCommand) {
    throw 'Ollama não foi encontrado no PATH.'
}

$ollamaVersion = (& ollama --version 2>&1 | Out-String).Trim()
$ollamaVersionMatch = [regex]::Match($ollamaVersion, '(\d+\.\d+\.\d+)')
if (-not $ollamaVersionMatch.Success) {
    throw "Não foi possível identificar a versão do Ollama: $ollamaVersion"
}

$installedOllamaVersion = [version]$ollamaVersionMatch.Groups[1].Value
if ($installedOllamaVersion -lt $minimumOllamaVersion) {
    throw "Qwen3.8 27B requer Ollama $minimumOllamaVersion ou superior. Versão encontrada: $installedOllamaVersion"
}

$apiOnline = $false
try {
    $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3
    $apiOnline = $true
} catch {
    $apiOnline = $false
}

Write-Host "Node.js: $nodeVersion (OK)"
Write-Host "Ollama: $ollamaVersion (OK)"
if ($apiOnline) {
    Write-Host 'API local do Ollama: online (OK)'
} else {
    Write-Warning 'Ollama está instalado, mas a API local ainda não respondeu. Abra o Ollama antes de iniciar o Strigoi.'
}
