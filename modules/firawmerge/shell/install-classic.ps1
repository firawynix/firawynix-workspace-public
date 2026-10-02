param([string] $AppPath)
$ErrorActionPreference = 'Stop'
if (-not $AppPath) { $AppPath = Join-Path $PSScriptRoot '..\release\win-unpacked\FirawMerge.exe' }
$AppPath = (Resolve-Path -LiteralPath $AppPath).Path
if (-not (Test-Path -LiteralPath $AppPath -PathType Leaf)) { throw 'FirawMerge.exe não encontrado.' }

$verbs = @(
  @{ Path = 'HKCU:\Software\Classes\Directory\shell\FirawMerge'; Argument = '%1' },
  @{ Path = 'HKCU:\Software\Classes\*\shell\FirawMerge'; Argument = '%1' },
  @{ Path = 'HKCU:\Software\Classes\Directory\Background\shell\FirawMerge'; Argument = '%V' }
)
foreach ($verb in $verbs) {
  New-Item -Path $verb.Path -Force -Value 'FirawMerge' | Out-Null
  Set-ItemProperty -Path $verb.Path -Name Icon -Value ('"{0}",0' -f $AppPath)
  Set-ItemProperty -Path $verb.Path -Name MultiSelectModel -Value 'Single'
  $commandKey = Join-Path $verb.Path 'command'
  New-Item -Path $commandKey -Force -Value ('"{0}" "{1}"' -f $AppPath, $verb.Argument) | Out-Null
}
Write-Output 'FirawMerge registrado para arquivos, pastas e fundo de pasta no menu clássico do Explorador.'
