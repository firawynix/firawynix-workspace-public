$ErrorActionPreference = 'Stop'
foreach ($key in @(
  'HKCU:\Software\Classes\Directory\shell\FirawMerge',
  'HKCU:\Software\Classes\*\shell\FirawMerge',
  'HKCU:\Software\Classes\Directory\Background\shell\FirawMerge'
)) {
  if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse -Force }
}
Write-Output 'Entradas clássicas do FirawMerge removidas.'
