[CmdletBinding()]
param(
    [string]$Model = 'strigoi-qwen3.8-27b',
    [ValidateRange(1, 10)]
    [int]$Runs = 3,
    [string]$Scenario = 'smoke',
    [string]$Prompt = 'Responda somente com a palavra STRIGOI.',
    [string]$Endpoint = 'http://127.0.0.1:11434',
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

function Convert-FromNanoseconds {
    param([object]$Nanoseconds)

    if ($null -eq $Nanoseconds) {
        return $null
    }

    return [math]::Round(([double]$Nanoseconds / 1000000), 2)
}

function Get-TokensPerSecond {
    param(
        [object]$TokenCount,
        [object]$DurationNanoseconds
    )

    if ($null -eq $TokenCount -or $null -eq $DurationNanoseconds -or [double]$DurationNanoseconds -le 0) {
        return $null
    }

    return [math]::Round(([double]$TokenCount / ([double]$DurationNanoseconds / 1000000000)), 2)
}

function Get-Average {
    param([object[]]$Values)

    $presentValues = @($Values | Where-Object { $null -ne $_ })
    if ($presentValues.Count -eq 0) {
        return $null
    }

    return [math]::Round((($presentValues | Measure-Object -Average).Average), 2)
}

function Test-ModelName {
    param(
        [object]$RunningModels,
        [string]$ExpectedModel
    )

    return @($RunningModels | Where-Object {
        $_.name -eq $ExpectedModel -or
        $_.model -eq $ExpectedModel -or
        $_.name -like "${ExpectedModel}:*" -or
        $_.model -like "${ExpectedModel}:*"
    }).Count -gt 0
}

function Get-LoadedModelMemory {
    param(
        [string]$ApiRoot,
        [string]$ExpectedModel
    )

    $running = Invoke-RestMethod -Uri "$ApiRoot/api/ps" -TimeoutSec 10
    $model = @($running.models | Where-Object {
        $_.name -eq $ExpectedModel -or
        $_.model -eq $ExpectedModel -or
        $_.name -like "${ExpectedModel}:*" -or
        $_.model -like "${ExpectedModel}:*"
    } | Select-Object -First 1)

    if ($model.Count -eq 0) {
        return $null
    }

    return [ordered]@{
        model_memory_gb = [math]::Round(([double]$model[0].size / 1GB), 2)
        vram_memory_gb = if ($null -ne $model[0].size_vram) { [math]::Round(([double]$model[0].size_vram / 1GB), 2) } else { $null }
        context_length = $model[0].context_length
    }
}

function Invoke-GenerationBenchmark {
    param(
        [string]$ApiRoot,
        [string]$TargetModel,
        [int]$RunNumber,
        [string]$BenchmarkPrompt
    )

    $payload = [ordered]@{
        model = $TargetModel
        prompt = $BenchmarkPrompt
        stream = $true
        think = $false
        keep_alive = '10m'
    } | ConvertTo-Json -Compress

    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromMinutes(10)
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, "$ApiRoot/api/generate")
    $request.Content = [System.Net.Http.StringContent]::new($payload, [System.Text.Encoding]::UTF8, 'application/json')
    $reader = $null
    $response = $null

    try {
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) {
            $details = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            throw "Ollama recusou a geração: $($response.StatusCode) $details"
        }

        $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $reader = [System.IO.StreamReader]::new($stream)
        $firstTokenMilliseconds = $null
        $responseCharacters = 0
        $finalChunk = $null

        while (($line = $reader.ReadLine()) -ne $null) {
            if ([string]::IsNullOrWhiteSpace($line)) {
                continue
            }

            $chunk = $line | ConvertFrom-Json
            if ($null -eq $firstTokenMilliseconds -and -not [string]::IsNullOrEmpty([string]$chunk.response)) {
                $firstTokenMilliseconds = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 2)
            }

            $responseCharacters += ([string]$chunk.response).Length
            if ($chunk.done) {
                $finalChunk = $chunk
            }
        }

        $stopwatch.Stop()
        if ($null -eq $finalChunk) {
            throw 'Ollama encerrou a resposta sem o bloco final de métricas.'
        }

        return [ordered]@{
            run = $RunNumber
            time_to_first_token_ms = $firstTokenMilliseconds
            total_wall_time_ms = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 2)
            total_duration_ms = Convert-FromNanoseconds $finalChunk.total_duration
            load_duration_ms = Convert-FromNanoseconds $finalChunk.load_duration
            prompt_tokens = $finalChunk.prompt_eval_count
            prompt_evaluation_ms = Convert-FromNanoseconds $finalChunk.prompt_eval_duration
            prompt_tokens_per_second = Get-TokensPerSecond $finalChunk.prompt_eval_count $finalChunk.prompt_eval_duration
            generated_tokens = $finalChunk.eval_count
            generation_ms = Convert-FromNanoseconds $finalChunk.eval_duration
            tokens_per_second = Get-TokensPerSecond $finalChunk.eval_count $finalChunk.eval_duration
            response_characters = $responseCharacters
        }
    } finally {
        if ($null -ne $reader) { $reader.Dispose() }
        if ($null -ne $response) { $response.Dispose() }
        $request.Dispose()
        $client.Dispose()
    }
}

$endpointUri = [uri]$Endpoint
if ($endpointUri.Host -notin @('127.0.0.1', 'localhost', '::1')) {
    throw 'O benchmark aceita somente um endpoint Ollama local.'
}

$apiRoot = $Endpoint.TrimEnd('/')
if (-not $OutputDirectory) {
    $projectRoot = Split-Path -Parent $PSScriptRoot
    $OutputDirectory = Join-Path $projectRoot 'work\benchmarks'
}

$availableModels = Invoke-RestMethod -Uri "$apiRoot/api/tags" -TimeoutSec 10
if (-not (Test-ModelName $availableModels.models $Model)) {
    throw "Modelo '$Model' não foi encontrado no Ollama local. Execute 'ollama list' e confira o nome."
}

$runningBefore = Invoke-RestMethod -Uri "$apiRoot/api/ps" -TimeoutSec 10
$machine = Get-CimInstance Win32_ComputerSystem
$processors = @(Get-CimInstance Win32_Processor | ForEach-Object { $_.Name.Trim() })
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
    [ordered]@{
        name = $_.Name
        driver_version = $_.DriverVersion
    }
})

$runResults = @()
for ($run = 1; $run -le $Runs; $run++) {
    Write-Host "Executando medicao $run de $Runs..."
    $result = Invoke-GenerationBenchmark -ApiRoot $apiRoot -TargetModel $Model -RunNumber $run -BenchmarkPrompt $Prompt
    $result.runtime_memory = Get-LoadedModelMemory -ApiRoot $apiRoot -ExpectedModel $Model
    $runResults += [pscustomobject]$result
}

$report = [ordered]@{
    benchmark = 'strigoi-local-model-v1'
    created_at = (Get-Date).ToUniversalTime().ToString('o')
    endpoint = $apiRoot
    model = $Model
    scenario = $Scenario
    prompt = $Prompt
    runs = $Runs
    model_was_loaded_before_benchmark = Test-ModelName $runningBefore.models $Model
    hardware = [ordered]@{
        system_memory_gb = [math]::Round(([double]$machine.TotalPhysicalMemory / 1GB), 2)
        processors = $processors
        gpus = $gpus
    }
    results = $runResults
    summary = [ordered]@{
        average_time_to_first_token_ms = Get-Average @($runResults | ForEach-Object { $_.time_to_first_token_ms })
        average_tokens_per_second = Get-Average @($runResults | ForEach-Object { $_.tokens_per_second })
        average_prompt_tokens_per_second = Get-Average @($runResults | ForEach-Object { $_.prompt_tokens_per_second })
        average_model_memory_gb = Get-Average @($runResults | ForEach-Object { $_.runtime_memory.model_memory_gb })
        average_vram_memory_gb = Get-Average @($runResults | ForEach-Object { $_.runtime_memory.vram_memory_gb })
    }
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$outputPath = Join-Path $OutputDirectory ("ollama-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outputPath -Encoding utf8

Write-Host ''
Write-Host "Benchmark concluido: $outputPath"
Write-Host "TTFT medio: $($report.summary.average_time_to_first_token_ms) ms"
Write-Host "Geracao media: $($report.summary.average_tokens_per_second) tokens/s"
Write-Host "VRAM media reportada: $($report.summary.average_vram_memory_gb) GB"
