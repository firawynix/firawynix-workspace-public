param(
    [Parameter(Mandatory = $true)]
    [string]$Models
)

$ErrorActionPreference = 'Stop'
$selectedModels = $Models -split ',' | Where-Object { $_.Trim() } | ForEach-Object { $_.Trim() }
if ($selectedModels.Count -eq 0) {
    exit 0
}

try {
    Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 3 | Out-Null
} catch {
    Write-Error 'Ollama não está disponível em http://127.0.0.1:11434.'
    exit 10
}

foreach ($model in $selectedModels) {
    Write-Host "Baixando $model..."
    $payload = @{ model = $model; stream = $true } | ConvertTo-Json -Compress
    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [System.Threading.Timeout]::InfiniteTimeSpan
    try {
        $content = [System.Net.Http.StringContent]::new($payload, [System.Text.Encoding]::UTF8, 'application/json')
        $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, 'http://127.0.0.1:11434/api/pull')
        $request.Content = $content
        $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        $response.EnsureSuccessStatusCode()
        $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $reader = [System.IO.StreamReader]::new($stream)
        while (($line = $reader.ReadLine()) -ne $null) {
            if (-not $line.Trim()) { continue }
            $event = $line | ConvertFrom-Json
            if ($event.status -eq 'success') {
                Write-Host "$model pronto."
                continue
            }
            $percent = 0
            if ($event.total -and $event.completed) {
                $percent = [Math]::Min(100, [Math]::Floor(($event.completed / $event.total) * 100))
            }
            $status = if ($event.status) { $event.status } else { 'processando' }
            Write-Host ("STRIGOI_PROGRESS|{0}|{1}|{2}" -f $model, $percent, $status)
        }
        $reader.Dispose()
        $stream.Dispose()
        $response.Dispose()
        $request.Dispose()
    } finally {
        $client.Dispose()
    }
}
