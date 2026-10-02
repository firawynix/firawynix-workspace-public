param(
    [Parameter(Mandatory = $true)]
    [string]$Models,
    [string]$ActiveModel,
    [Parameter(Mandatory = $true)]
    [string]$CatalogPath,
    [Parameter(Mandatory = $true)]
    [string]$DestinationDirectory,
    [string]$RuntimeConfigPath,
    [string]$LogPath,
    [switch]$ShowProgress,
    [string]$SuccessMarkerPath
)

$ErrorActionPreference = 'Stop'
if ($SuccessMarkerPath) {
    Remove-Item -LiteralPath $SuccessMarkerPath -Force -ErrorAction SilentlyContinue
}

$progressForm = $null
$progressBar = $null
$progressLabel = $null
if ($ShowProgress) {
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        Add-Type -AssemblyName System.Drawing -ErrorAction Stop
        $progressForm = New-Object System.Windows.Forms.Form
        $progressForm.Text = 'Strigoi Setup — download do modelo'
        $progressForm.StartPosition = 'CenterScreen'
        $progressForm.FormBorderStyle = 'FixedDialog'
        $progressForm.ControlBox = $false
        $progressForm.ClientSize = New-Object System.Drawing.Size(430, 82)
        $progressLabel = New-Object System.Windows.Forms.Label
        $progressLabel.SetBounds(16, 12, 398, 20)
        $progressLabel.Text = 'Preparando download...'
        $progressBar = New-Object System.Windows.Forms.ProgressBar
        $progressBar.SetBounds(16, 40, 398, 20)
        $progressBar.Minimum = 0
        $progressBar.Maximum = 100
        $progressForm.Controls.AddRange(@($progressLabel, $progressBar))
        $progressForm.Show()
        [System.Windows.Forms.Application]::DoEvents()
    } catch {
        $progressForm = $null
    }
}
if ($LogPath) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $LogPath) -Force | Out-Null
    "[$((Get-Date).ToUniversalTime().ToString('o'))] Iniciando instalação de modelos: $Models" | Set-Content -LiteralPath $LogPath -Encoding utf8
    "[$((Get-Date).ToUniversalTime().ToString('o'))] PowerShell: $($PSVersionTable.PSVersion)" | Add-Content -LiteralPath $LogPath -Encoding utf8
}
trap {
    if ($LogPath) {
        "[$((Get-Date).ToUniversalTime().ToString('o'))] FALHOU: $($_.Exception.Message)" | Add-Content -LiteralPath $LogPath -Encoding utf8
    }
    exit 1
}
try {
    # Windows PowerShell 5.1 does not load System.Net.Http by default, while
    # PowerShell 7 does. The NSIS setup explicitly starts Windows PowerShell.
    Add-Type -AssemblyName System.Net.Http -ErrorAction Stop
} catch {
    throw "Não foi possível carregar o componente HTTP do Windows: $($_.Exception.Message)"
}
$selectedModels = @($Models -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($selectedModels.Count -eq 0) {
    exit 0
}

function Assert-CatalogEntry {
    param([pscustomobject]$Entry)

    $hasUnsafePathSegment = @($Entry.artifact.file -split '/' | Where-Object { -not $_ -or $_ -eq '.' -or $_ -eq '..' }).Count -gt 0
    if (-not $Entry -or
        $Entry.artifact.repository -notmatch '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$' -or
        $Entry.artifact.revision -notmatch '^[A-Za-z0-9._-]+$' -or
        $hasUnsafePathSegment -or
        $Entry.artifact.sha256 -notmatch '^[a-f0-9]{64}$' -or
        [Int64]$Entry.artifact.sizeBytes -le 0) {
        throw "O catálogo do modelo '$($Entry.id)' não passou na validação de segurança."
    }
}

function Get-AvailableBytes {
    param([string]$Directory)

    $root = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($Directory))
    $drive = Get-PSDrive -Name $root.TrimEnd(':', '\') -ErrorAction Stop
    return [Int64]$drive.Free
}

function Get-ModelUrl {
    param([pscustomobject]$Entry)

    $segments = @($Entry.artifact.file -split '/' | ForEach-Object { [Uri]::EscapeDataString($_) }) -join '/'
    return "https://huggingface.co/$($Entry.artifact.repository)/resolve/$($Entry.artifact.revision)/$segments"
}

function Test-Hash {
    param([string]$Path, [string]$Expected)

    # Get-FileHash is not guaranteed to be available in the constrained
    # Windows PowerShell host started by NSIS. Use the .NET implementation
    # instead, so verification and the manifest creation work on Windows 5.1.
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $stream = $null
    try {
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
        $actual = [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
        return $actual -eq $Expected.ToLowerInvariant()
    } finally {
        if ($stream) {
            $stream.Dispose()
        }
        $sha256.Dispose()
    }
}

function Download-Model {
    param([pscustomobject]$Entry)

    Assert-CatalogEntry $Entry
    $destination = Join-Path $DestinationDirectory $Entry.artifact.file
    $partial = "$destination.part"
    $directory = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $directory -Force | Out-Null

    if (Test-Path -LiteralPath $destination) {
        if (Test-Hash $destination $Entry.artifact.sha256) {
            Write-Host "$($Entry.name) já foi verificado."
            return $destination
        }
        Remove-Item -LiteralPath $destination -Force
    }

    $received = if (Test-Path -LiteralPath $partial) { [Int64](Get-Item -LiteralPath $partial).Length } else { 0 }
    $required = [Int64]$Entry.artifact.sizeBytes - $received
    if ((Get-AvailableBytes $DestinationDirectory) -lt ($required + 1GB)) {
        throw "Não há espaço livre suficiente para baixar $($Entry.name) com segurança."
    }

    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [System.Threading.Timeout]::InfiniteTimeSpan
    try {
        $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, (Get-ModelUrl $Entry))
        if ($received -gt 0) {
            $request.Headers.Range = [System.Net.Http.Headers.RangeHeaderValue]::new($received, $null)
        }
        $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        # EnsureSuccessStatusCode returns the HttpResponseMessage itself. Inside a
        # PowerShell function that object becomes part of the function's success
        # output and turns the returned model path into an array. Keep the HTTP
        # response out of the pipeline so Download-Model returns only the GGUF.
        $response.EnsureSuccessStatusCode() | Out-Null
        $append = $received -gt 0 -and $response.StatusCode -eq [System.Net.HttpStatusCode]::PartialContent
        if (-not $append -and $received -gt 0) {
            Remove-Item -LiteralPath $partial -Force
            $received = 0
        }
        $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $mode = if ($append) { [System.IO.FileMode]::Append } else { [System.IO.FileMode]::Create }
        $output = [System.IO.FileStream]::new($partial, $mode, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try {
            $buffer = New-Object byte[] 1048576
            $written = $received
            $lastPercent = -1
            while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $output.Write($buffer, 0, $read)
                $written += $read
                $percent = [Math]::Min(100, [Math]::Floor(($written / [Int64]$Entry.artifact.sizeBytes) * 100))
                if ($percent -ne $lastPercent) {
                    Write-Host ("STRIGOI_PROGRESS|{0}|{1}|baixando" -f $Entry.id, $percent)
                    if ($progressForm) {
                        $progressBar.Value = [int]$percent
                        $progressLabel.Text = "Baixando $($Entry.name): $percent%"
                        [System.Windows.Forms.Application]::DoEvents()
                    }
                    $lastPercent = $percent
                }
            }
        } finally {
            $output.Dispose()
            $stream.Dispose()
            $response.Dispose()
            $request.Dispose()
        }
    } finally {
        $client.Dispose()
    }

    if (-not (Test-Hash $partial $Entry.artifact.sha256)) {
        Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
        throw "A verificação SHA-256 falhou para $($Entry.name); o download foi descartado."
    }
    Move-Item -LiteralPath $partial -Destination $destination -Force
    Write-Host "$($Entry.name) pronto e verificado."
    return $destination
}

if (-not (Test-Path -LiteralPath $CatalogPath)) {
    throw 'O catálogo de modelos do Strigoi não foi encontrado no instalador.'
}

$catalog = Get-Content -LiteralPath $CatalogPath -Raw | ConvertFrom-Json
if ($catalog.schemaVersion -ne 1) {
    throw 'A versão do catálogo de modelos não é compatível com este instalador.'
}
New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
$downloaded = @{}
foreach ($modelId in $selectedModels) {
    $entry = @($catalog.models | Where-Object { $_.id -eq $modelId })[0]
    if (-not $entry) {
        throw "Modelo local desconhecido: $modelId."
    }
    [string]$downloadedPath = Download-Model $entry
    if (-not [System.IO.File]::Exists($downloadedPath)) {
        throw "O download de $($entry.name) não produziu um arquivo GGUF válido."
    }
    $downloaded[$modelId] = $downloadedPath
}

[string]$activePath = if ($ActiveModel -and $downloaded.ContainsKey($ActiveModel)) {
    $downloaded[$ActiveModel]
} else {
    $downloaded[$selectedModels[0]]
}

@{
    activeModel = (Split-Path -Leaf $activePath)
    installedAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $DestinationDirectory 'strigoi-model-selection.json') -Encoding utf8

if ($RuntimeConfigPath) {
    $runtimeConfig = @{
        schemaVersion = 1
        modelsDirectory = [System.IO.Path]::GetFullPath($DestinationDirectory)
        activeModel = (Split-Path -Leaf $activePath)
        modelPath = [System.IO.Path]::GetFullPath($activePath)
        installedAt = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json
    New-Item -ItemType Directory -Path (Split-Path -Parent $RuntimeConfigPath) -Force | Out-Null
    $temporaryConfigPath = "$RuntimeConfigPath.part"
    $runtimeConfig | Set-Content -LiteralPath $temporaryConfigPath -Encoding utf8
    Move-Item -LiteralPath $temporaryConfigPath -Destination $RuntimeConfigPath -Force
}

if ($LogPath) {
    "[$((Get-Date).ToUniversalTime().ToString('o'))] Concluído. Modelo ativo: $(Split-Path -Leaf $activePath)" | Add-Content -LiteralPath $LogPath -Encoding utf8
}
if ($SuccessMarkerPath) {
    'verified' | Set-Content -LiteralPath $SuccessMarkerPath -Encoding ascii
}
if ($progressForm) {
    $progressBar.Value = 100
    $progressLabel.Text = 'Download concluído e verificado.'
    [System.Windows.Forms.Application]::DoEvents()
    $progressForm.Close()
    $progressForm.Dispose()
}
exit 0
