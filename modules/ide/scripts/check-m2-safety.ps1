$ErrorActionPreference = 'Stop'

$agentPath = Join-Path $PSScriptRoot '..\strigoi-core\src\browser\strigoi-agent.ts'
if (-not (Test-Path -LiteralPath $agentPath)) {
    throw "Arquivo do agente não encontrado: $agentPath"
}

$source = Get-Content -LiteralPath $agentPath -Raw
$requiredRules = @(
    'Call the workspace listing tool at most once',
    'Never retry the same tool with the same arguments',
    'Keep the first pass to at most 12 files',
    'create a proposed change set',
    'Do not apply, overwrite, or discard a change set',
    'A tool may be called at most twice for the same objective'
)

$missingRules = @($requiredRules | Where-Object { $source -notlike "*$($_)*" })
if ($missingRules.Count -gt 0) {
    throw "Contrato M2 incompleto. Regras ausentes: $($missingRules -join '; ')"
}

if ($source -notlike '*getCoderPromptTemplateEdit()*') {
    throw 'O Modo agente não está usando o template seguro de change sets do Theia.'
}

if ($source -match 'getCoderAgentModePromptTemplate|WRITE_FILE_(CONTENT|REPLACEMENTS)_ID') {
    throw 'O Modo agente ainda pode expor ferramentas de escrita direta ao modelo.'
}

if ($source -notlike '*Automatic skill routing*' -or $source -notlike '*native Skill Router*' -or $source -notlike '*skill adds guidance only*') {
    throw 'Roteamento automático de skills não encontrado no prompt do Strigoi.'
}

Write-Host "M2 safety contract: OK ($($requiredRules.Count) regras + change sets revisáveis + roteamento de skills verificados)"
