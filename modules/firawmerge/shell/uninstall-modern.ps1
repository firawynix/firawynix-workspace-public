$ErrorActionPreference = 'Stop'
$package = Get-AppxPackage -Name 'Firawynix.FirawMerge.ContextV2'
if ($package) { $package | Remove-AppxPackage -ErrorAction Stop }
Write-Output 'Extensão moderna do FirawMerge removida para este usuário.'
