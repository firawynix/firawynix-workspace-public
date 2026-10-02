$ErrorActionPreference = 'Stop'
$package = Get-AppxPackage -Name 'Firawynix.FirawMerge.ContextV2'
if ($package) { $package | Remove-AppxPackage -ErrorAction Stop }
foreach ($key in @(
  'HKCU:\Software\Classes\Directory\shell\FirawMerge',
  'HKCU:\Software\Classes\*\shell\FirawMerge',
  'HKCU:\Software\Classes\Directory\Background\shell\FirawMerge',
  'HKCU:\Software\Firawynix\FirawMerge'
)) { if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse -Force } }
