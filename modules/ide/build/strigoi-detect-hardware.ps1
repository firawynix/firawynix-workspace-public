param(
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

function Get-DedicatedVramGiB {
    $registryPath = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
    $values = @()
    try {
        # Alguns drivers criam subchaves protegidas. Uma delas não pode invalidar
        # a leitura de placas que já reportaram VRAM corretamente.
        $values = @(Get-ChildItem -LiteralPath $registryPath -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                [UInt64](Get-ItemPropertyValue -LiteralPath $_.PSPath -Name 'HardwareInformation.qwMemorySize' -ErrorAction Stop)
            } catch {
                $null
            }
        } | Where-Object { $_ -and $_ -gt 0 })
    } catch {
        $values = @()
    }

    if ($values.Count -gt 0) {
        return [math]::Round((($values | Measure-Object -Maximum).Maximum / 1GB), 0)
    }

    $fallback = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch 'Microsoft Basic Display' -and $_.AdapterRAM } |
        ForEach-Object { [UInt64]$_.AdapterRAM })
    if ($fallback.Count -gt 0) {
        return [math]::Round((($fallback | Measure-Object -Maximum).Maximum / 1GB), 0)
    }
    return 0
}

$computer = Get-CimInstance Win32_ComputerSystem
$ramGiB = [math]::Round($computer.TotalPhysicalMemory / 1GB, 0)
$logicalProcessors = [int]$computer.NumberOfLogicalProcessors
$vramGiB = Get-DedicatedVramGiB
$diskGiB = [math]::Floor((Get-PSDrive -Name $env:SystemDrive.TrimEnd(':')).Free / 1GB)
$profile = if ($vramGiB -ge 40 -and $ramGiB -ge 64) {
    'dev-pro'
} elseif ($vramGiB -ge 16 -and $ramGiB -ge 32) {
    'balanced'
} elseif (($vramGiB -ge 8 -and $ramGiB -ge 16) -or ($vramGiB -eq 0 -and $ramGiB -ge 32 -and $logicalProcessors -ge 8)) {
    'dev-lite'
} else {
    'essential'
}

$supportsEssential = $ramGiB -ge 12 -and $diskGiB -ge 5
$supportsLite = (($vramGiB -ge 8 -and $ramGiB -ge 16) -or ($vramGiB -eq 0 -and $ramGiB -ge 32 -and $logicalProcessors -ge 8)) -and $diskGiB -ge 8
$supportsBalanced = $vramGiB -ge 16 -and $ramGiB -ge 32 -and $diskGiB -ge 14
$supportsReasoning = $vramGiB -ge 16 -and $ramGiB -ge 32 -and $diskGiB -ge 14
$supportsAgent = $vramGiB -ge 40 -and $ramGiB -ge 64 -and $diskGiB -ge 36

$directory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $directory -Force | Out-Null
@"
[hardware]
profile=$profile
summary=$ramGiB GB RAM | GPU $vramGiB GB VRAM | CPU $logicalProcessors threads | $diskGiB GB livres
supportsEssential=$([int]$supportsEssential)
supportsLite=$([int]$supportsLite)
supportsBalanced=$([int]$supportsBalanced)
supportsReasoning=$([int]$supportsReasoning)
supportsAgent=$([int]$supportsAgent)
"@ | Set-Content -LiteralPath $OutputPath -Encoding ascii
