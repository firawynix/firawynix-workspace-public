$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$modelRoot = Join-Path $projectRoot 'models'
$modelFiles = @(Get-ChildItem -LiteralPath $modelRoot -Filter '*.gguf' -File -Recurse)

if ($modelFiles.Count -ne 1) {
    throw "Coloque exatamente um arquivo .gguf dentro de $modelRoot. Encontrados: $($modelFiles.Count)."
}

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    throw 'Ollama não foi encontrado no PATH.'
}

$modelDirectory = $modelFiles[0].DirectoryName
$generatedModelfile = Join-Path $modelDirectory 'Modelfile.generated'
$relativeModelName = $modelFiles[0].Name
@"
FROM ./$relativeModelName
PARAMETER temperature 0.2
PARAMETER num_ctx 32768
"@ | Set-Content -LiteralPath $generatedModelfile -Encoding utf8

& ollama create 'strigoi-qwen3.8-27b' --file $generatedModelfile
if ($LASTEXITCODE -ne 0) {
    throw "Ollama não conseguiu registrar o modelo. Código: $LASTEXITCODE"
}

Write-Host 'Modelo registrado como strigoi-qwen3.8-27b.'
