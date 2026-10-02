!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

!define STRIGOI_LV_CHECKED 0x2000
!define STRIGOI_LV_INSTALLED 0x2004

!define Strigoi_LV_InsertItem `!insertmacro Strigoi_LV_InsertItem`
!macro Strigoi_LV_InsertItem CONTROL INDEX STRING
  System::Call "*(i${LVIF_TEXT},i${INDEX},i,i,&i${NSIS_PTR_SIZE},t'${STRING}',i${NSIS_MAX_STRLEN},i,p,i,i,i,i,i,i) p.s"
  Exch $0
  SendMessage ${CONTROL} ${LVM_INSERTITEM} 0 $0
  System::Free $0
  Pop $0
!macroend

!define Strigoi_LV_SetItemState `!insertmacro Strigoi_LV_SetItemState`
!macro Strigoi_LV_SetItemState CONTROL INDEX STATE
  System::Call "*(i${LVIF_STATE},i${INDEX},i,i${STATE},&i${NSIS_PTR_SIZE} ${STATE},t,i,i,p,i,i,i,i,i,i) p.s"
  Exch $0
  SendMessage ${CONTROL} ${LVM_SETITEMSTATE} ${INDEX} $0
  System::Free $0
  Pop $0
!macroend

!ifndef BUILD_UNINSTALLER
Var StrigoiModels
Var StrigoiPreferredModel
Var StrigoiModelList
Var StrigoiModelCount
Var StrigoiProfile
Var StrigoiEssentialIndex
Var StrigoiLiteIndex
Var StrigoiBalancedIndex
Var StrigoiReasoningIndex
Var StrigoiAgentIndex
Var StrigoiSubagentIndex
Var StrigoiSupportsEssential
Var StrigoiSupportsLite
Var StrigoiSupportsBalanced
Var StrigoiSupportsReasoning
Var StrigoiSupportsAgent
Var StrigoiInstallMode
Var StrigoiMaintenanceKeep
Var StrigoiMaintenanceModify
Var StrigoiPreservedModels
Var StrigoiEssentialInstalled
Var StrigoiLiteInstalled
Var StrigoiBalancedInstalled
Var StrigoiReasoningInstalled
Var StrigoiAgentInstalled
Var StrigoiSubagentInstalled

!macro customInit
  ; An update runs the previous uninstaller first. Move the model directory to
  ; a sibling on the same volume so that that cleanup cannot remove the LLMs.
  StrCpy $StrigoiPreservedModels "$INSTDIR\..\Strigoi-models-preserve"
  IfFileExists "$INSTDIR\models\*.*" 0 strigoi_preserve_models_done
  IfFileExists "$StrigoiPreservedModels\*.*" 0 +2
    RMDir /r "$StrigoiPreservedModels"
  Rename "$INSTDIR\models" "$StrigoiPreservedModels"
strigoi_preserve_models_done:
!macroend

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
  Page custom StrigoiMaintenancePageCreate StrigoiMaintenancePageLeave
  Page custom StrigoiModelPageCreate StrigoiModelPageLeave
!macroend

Function StrigoiMaintenancePageCreate
  ; Start with a clean-install mode. The page is skipped unless the existing
  ; installation marker is present in the default installation directory.
  StrCpy $StrigoiInstallMode "new"
  IfFileExists "$INSTDIR\resources\app\package.json" 0 strigoi_maintenance_skip

  !insertmacro MUI_HEADER_TEXT "Manutenção do Strigoi" "Escolha como atualizar a instalação existente."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 30u "Esta instalação já existe. Os modelos locais serão preservados durante a atualização."
  Pop $1
  ${NSD_CreateRadioButton} 0 40u 100% 18u "Atualizar o Strigoi (manter modelos)"
  Pop $StrigoiMaintenanceKeep
  ${NSD_SetState} $StrigoiMaintenanceKeep ${BST_CHECKED}
  ${NSD_CreateRadioButton} 0 64u 100% 18u "Modificar modelos locais"
  Pop $StrigoiMaintenanceModify
  nsDialogs::Show
  Return

strigoi_maintenance_skip:
  Abort
FunctionEnd

Function StrigoiMaintenancePageLeave
  ${If} $StrigoiMaintenanceModify != 0
    ${NSD_GetState} $StrigoiMaintenanceModify $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $StrigoiInstallMode "modify"
    ${Else}
      StrCpy $StrigoiInstallMode "update"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function StrigoiModelPageCreate
  !insertmacro MUI_HEADER_TEXT "Modelos locais" "Escolha os modelos que o Strigoi deve baixar para a IA local."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  File /oname=$PLUGINSDIR\strigoi-detect-hardware.ps1 "${BUILD_RESOURCES_DIR}\strigoi-detect-hardware.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\strigoi-detect-hardware.ps1" -OutputPath "$PLUGINSDIR\strigoi-hardware.ini"'
  Pop $0
  ReadINIStr $1 "$PLUGINSDIR\strigoi-hardware.ini" "hardware" "summary"
  ${NSD_CreateLabel} 0 0 100% 18u "Detectado: $1"
  Pop $2
  ${NSD_CreateLabel} 0 20u 100% 18u "As recomendações reservam memória para Windows, IDE e contexto."
  Pop $2
  ${NSD_CreateLabel} 0 36u 100% 18u "As referências usam modelos de mercado e são aproximadas: variam por tarefa e hardware."
  Pop $2
  ${NSD_CreateLabel} 0 52u 100% 18u "O Strigoi baixará GGUFs verificados diretamente para o runtime próprio."
  Pop $2

  ReadINIStr $1 "$PLUGINSDIR\strigoi-hardware.ini" "hardware" "profile"
  StrCpy $StrigoiProfile $1
  ${If} $StrigoiProfile == "essential"
    StrCpy $StrigoiPreferredModel "qwen2.5-coder-3b-instruct-q4-k-m"
  ${ElseIf} $StrigoiProfile == "dev-lite"
    StrCpy $StrigoiPreferredModel "qwen2.5-coder-7b-instruct-q4-k-m"
  ${ElseIf} $StrigoiProfile == "balanced"
    StrCpy $StrigoiPreferredModel "qwen3-14b-q4-k-m"
  ${ElseIf} $StrigoiProfile == "reasoning"
    StrCpy $StrigoiPreferredModel "gpt-oss-20b-mxfp4"
  ${Else}
    StrCpy $StrigoiPreferredModel "qwen3-coder-30b-a3b-instruct-q8-0"
  ${EndIf}
  ReadINIStr $StrigoiSupportsEssential "$PLUGINSDIR\strigoi-hardware.ini" "hardware" "supportsEssential"
  ReadINIStr $StrigoiSupportsLite "$PLUGINSDIR\strigoi-hardware.ini" "hardware" "supportsLite"
  ReadINIStr $StrigoiSupportsBalanced "$PLUGINSDIR\strigoi-hardware.ini" "hardware" "supportsBalanced"
  ReadINIStr $StrigoiSupportsReasoning "$PLUGINSDIR\strigoi-hardware.ini" "hardware" "supportsReasoning"
  ReadINIStr $StrigoiSupportsAgent "$PLUGINSDIR\strigoi-hardware.ini" "hardware" "supportsAgent"

  ${If} $StrigoiInstallMode == "update"
    ${NSD_CreateLabel} 0 68u 100% 40u "Modo atualização: os modelos locais existentes serão mantidos. Para baixar ou trocar modelos, volte e escolha ‘Modificar modelos locais’."
    Pop $2
    nsDialogs::Show
    Return
  ${EndIf}

  StrCpy $StrigoiModelCount 0
  StrCpy $StrigoiEssentialIndex -1
  StrCpy $StrigoiLiteIndex -1
  StrCpy $StrigoiBalancedIndex -1
  StrCpy $StrigoiReasoningIndex -1
  StrCpy $StrigoiAgentIndex -1
  StrCpy $StrigoiSubagentIndex -1
  Call StrigoiDetectInstalledModels

  nsDialogs::CreateControl "SysListView32" "${DEFAULT_STYLES}|${LVS_LIST}|${LVS_SHOWSELALWAYS}" "${WS_EX_CLIENTEDGE}" 0 68u 100% 54u "Modelos"
  Pop $StrigoiModelList
  SendMessage $StrigoiModelList ${LVM_SETEXTENDEDLISTVIEWSTYLE} 0 ${LVS_EX_CHECKBOXES}|${LVS_EX_FULLROWSELECT}

  ${If} $StrigoiSupportsEssential == "1"
    ${If} $StrigoiEssentialInstalled == "1"
      ${Strigoi_LV_InsertItem} $StrigoiModelList $StrigoiModelCount "[Já instalado] Essencial — Qwen2.5-Coder 3B (mantido)"
    ${Else}
      ${Strigoi_LV_InsertItem} $StrigoiModelList $StrigoiModelCount "Essencial — Qwen2.5-Coder 3B (≈ Claude Haiku; 2,2 GB)"
    ${EndIf}
    StrCpy $StrigoiEssentialIndex $StrigoiModelCount
    ${If} $StrigoiEssentialInstalled == "1"
      ${Strigoi_LV_SetItemState} $StrigoiModelList $StrigoiEssentialIndex ${STRIGOI_LV_INSTALLED}|${LVIS_STATEIMAGEMASK}
    ${ElseIf} $StrigoiProfile == "essential"
      ${Strigoi_LV_SetItemState} $StrigoiModelList $StrigoiEssentialIndex ${STRIGOI_LV_CHECKED}|${LVIS_STATEIMAGEMASK}
    ${EndIf}
    IntOp $StrigoiModelCount $StrigoiModelCount + 1
  ${EndIf}
  ${If} $StrigoiSupportsLite == "1"
    ${If} $StrigoiLiteInstalled == "1"
      ${Strigoi_LV_InsertItem} $StrigoiModelList $StrigoiModelCount "[Já instalado] Dev Lite — Qwen2.5-Coder 7B (mantido)"
    ${Else}
      ${Strigoi_LV_InsertItem} $StrigoiModelList $StrigoiModelCount "Dev Lite — Qwen2.5-Coder 7B (≈ GPT-4o mini; 5 GB)"
    ${EndIf}
    StrCpy $StrigoiLiteIndex $StrigoiModelCount
    ${If} $StrigoiLiteInstalled == "1"
      ${Strigoi_LV_SetItemState} $StrigoiModelList $StrigoiLiteIndex ${STRIGOI_LV_INSTALLED}|${LVIS_STATEIMAGEMASK}
    ${ElseIf} $StrigoiProfile == "dev-lite"
      ${Strigoi_LV_SetItemState} $StrigoiModelList $StrigoiLiteIndex ${STRIGOI_LV_CHECKED}|${LVIS_STATEIMAGEMASK}
    ${EndIf}
    IntOp $StrigoiModelCount $StrigoiModelCount + 1
  ${EndIf}
  ${If} $StrigoiSupportsBalanced == "1"
    ${If} $StrigoiBalancedInstalled == "1"
      ${Strigoi_LV_InsertItem} $StrigoiModelList $StrigoiModelCount "[Já instalado] Balanced — Qwen3 14B (mantido)"
    ${Else}
      ${Strigoi_LV_InsertItem} $StrigoiModelList $StrigoiModelCount "Balanced — Qwen3 14B (≈ GPT-4.1 mini; 9 GB)"
    ${EndIf}
    StrCpy $StrigoiBalancedIndex $StrigoiModelCount
    ${If} $StrigoiBalancedInstalled == "1"
      ${Strigoi_LV_SetItemState} $StrigoiModelList $StrigoiBalancedIndex ${STRIGOI_LV_INSTALLED}|${LVIS_STATEIMAGEMASK}
    ${ElseIf} $StrigoiProfile == "balanced"
      ${Strigoi_LV_SetItemState} $StrigoiModelList $StrigoiBalancedIndex ${STRIGOI_LV_CHECKED}|${LVIS_STATEIMAGEMASK}
    ${EndIf}
    IntOp $StrigoiModelCount $StrigoiModelCount + 1
  ${EndIf}
  ${If} $StrigoiSupportsReasoning == "1"
    ${If} $StrigoiReasoningInstalled == "1"
      ${Strigoi_LV_InsertItem} $StrigoiModelList $StrigoiModelCount "[Já instalado] Raciocínio — gpt-oss 20B (mantido)"
    ${Else}
      ${Strigoi_LV_InsertItem} $StrigoiModelList $StrigoiModelCount "Raciocínio — gpt-oss 20B (≈ o3-mini; 12,1 GB)"
    ${EndIf}
    StrCpy $StrigoiReasoningIndex $StrigoiModelCount
    ${If} $StrigoiReasoningInstalled == "1"
      ${Strigoi_LV_SetItemState} $StrigoiModelList $StrigoiReasoningIndex ${STRIGOI_LV_INSTALLED}|${LVIS_STATEIMAGEMASK}
    ${ElseIf} $StrigoiProfile == "reasoning"
      ${Strigoi_LV_SetItemState} $StrigoiModelList $StrigoiReasoningIndex ${STRIGOI_LV_CHECKED}|${LVIS_STATEIMAGEMASK}
    ${EndIf}
    IntOp $StrigoiModelCount $StrigoiModelCount + 1
  ${EndIf}
  ${If} $StrigoiSupportsAgent == "1"
    ${If} $StrigoiAgentInstalled == "1"
      ${Strigoi_LV_InsertItem} $StrigoiModelList $StrigoiModelCount "[Já instalado] Dev Pro — Qwen3-Coder 30B (mantido)"
    ${Else}
      ${Strigoi_LV_InsertItem} $StrigoiModelList $StrigoiModelCount "Dev Pro — Qwen3-Coder 30B (≈ Claude Sonnet; 32,5 GB)"
    ${EndIf}
    StrCpy $StrigoiAgentIndex $StrigoiModelCount
    ${If} $StrigoiAgentInstalled == "1"
      ${Strigoi_LV_SetItemState} $StrigoiModelList $StrigoiAgentIndex ${STRIGOI_LV_INSTALLED}|${LVIS_STATEIMAGEMASK}
    ${ElseIf} $StrigoiProfile == "agent"
      ${Strigoi_LV_SetItemState} $StrigoiModelList $StrigoiAgentIndex ${STRIGOI_LV_CHECKED}|${LVIS_STATEIMAGEMASK}
    ${EndIf}
    IntOp $StrigoiModelCount $StrigoiModelCount + 1
  ${EndIf}
  ${If} $StrigoiSupportsEssential == "1"
    ${If} $StrigoiSubagentInstalled == "1"
      ${Strigoi_LV_InsertItem} $StrigoiModelList $StrigoiModelCount "[Já instalado] Subagente — Qwen3 4B (mantido)"
    ${Else}
      ${Strigoi_LV_InsertItem} $StrigoiModelList $StrigoiModelCount "Subagente — Qwen3 4B (≈ GPT-4o mini; 2,5 GB)"
    ${EndIf}
    StrCpy $StrigoiSubagentIndex $StrigoiModelCount
    ${If} $StrigoiSubagentInstalled == "1"
      ${Strigoi_LV_SetItemState} $StrigoiModelList $StrigoiSubagentIndex ${STRIGOI_LV_INSTALLED}|${LVIS_STATEIMAGEMASK}
    ${EndIf}
  ${EndIf}

  ${NSD_CreateLabel} 0 126u 100% 16u "Itens [Já instalado] serão mantidos e não serão baixados novamente. Você pode marcar mais de uma opção."
  Pop $2

  nsDialogs::Show
FunctionEnd

Function StrigoiModelPageLeave
  StrCpy $StrigoiModels ""
  ${If} $StrigoiInstallMode == "update"
    Return
  ${EndIf}
  ${If} $StrigoiEssentialIndex >= 0
      SendMessage $StrigoiModelList ${LVM_GETITEMSTATE} $StrigoiEssentialIndex ${LVIS_STATEIMAGEMASK} $0
      IntOp $0 $0 & ${LVIS_STATEIMAGEMASK}
    ${Else}
      StrCpy $0 0
    ${EndIf}
    ${If} $0 == ${STRIGOI_LV_CHECKED}
    ${AndIf} $StrigoiEssentialInstalled != "1"
      StrCpy $StrigoiModels "qwen2.5-coder-3b-instruct-q4-k-m"
    ${EndIf}
    ${If} $StrigoiLiteIndex >= 0
      SendMessage $StrigoiModelList ${LVM_GETITEMSTATE} $StrigoiLiteIndex ${LVIS_STATEIMAGEMASK} $0
      IntOp $0 $0 & ${LVIS_STATEIMAGEMASK}
    ${Else}
      StrCpy $0 0
    ${EndIf}
    ${If} $0 == ${STRIGOI_LV_CHECKED}
    ${AndIf} $StrigoiLiteInstalled != "1"
      ${If} $StrigoiModels == ""
        StrCpy $StrigoiModels "qwen2.5-coder-7b-instruct-q4-k-m"
      ${Else}
        StrCpy $StrigoiModels "$StrigoiModels,qwen2.5-coder-7b-instruct-q4-k-m"
      ${EndIf}
    ${EndIf}
    ${If} $StrigoiBalancedIndex >= 0
      SendMessage $StrigoiModelList ${LVM_GETITEMSTATE} $StrigoiBalancedIndex ${LVIS_STATEIMAGEMASK} $0
      IntOp $0 $0 & ${LVIS_STATEIMAGEMASK}
    ${Else}
      StrCpy $0 0
    ${EndIf}
    ${If} $0 == ${STRIGOI_LV_CHECKED}
    ${AndIf} $StrigoiBalancedInstalled != "1"
      ${If} $StrigoiModels == ""
        StrCpy $StrigoiModels "qwen3-14b-q4-k-m"
      ${Else}
        StrCpy $StrigoiModels "$StrigoiModels,qwen3-14b-q4-k-m"
      ${EndIf}
    ${EndIf}
    ${If} $StrigoiReasoningIndex >= 0
      SendMessage $StrigoiModelList ${LVM_GETITEMSTATE} $StrigoiReasoningIndex ${LVIS_STATEIMAGEMASK} $0
      IntOp $0 $0 & ${LVIS_STATEIMAGEMASK}
    ${Else}
      StrCpy $0 0
    ${EndIf}
    ${If} $0 == ${STRIGOI_LV_CHECKED}
    ${AndIf} $StrigoiReasoningInstalled != "1"
      ${If} $StrigoiModels == ""
        StrCpy $StrigoiModels "gpt-oss-20b-mxfp4"
      ${Else}
        StrCpy $StrigoiModels "$StrigoiModels,gpt-oss-20b-mxfp4"
      ${EndIf}
    ${EndIf}
    ${If} $StrigoiAgentIndex >= 0
      SendMessage $StrigoiModelList ${LVM_GETITEMSTATE} $StrigoiAgentIndex ${LVIS_STATEIMAGEMASK} $0
      IntOp $0 $0 & ${LVIS_STATEIMAGEMASK}
    ${Else}
      StrCpy $0 0
    ${EndIf}
    ${If} $0 == ${STRIGOI_LV_CHECKED}
    ${AndIf} $StrigoiAgentInstalled != "1"
      ${If} $StrigoiModels == ""
        StrCpy $StrigoiModels "qwen3-coder-30b-a3b-instruct-q8-0"
      ${Else}
        StrCpy $StrigoiModels "$StrigoiModels,qwen3-coder-30b-a3b-instruct-q8-0"
      ${EndIf}
    ${EndIf}

    ${If} $StrigoiSubagentIndex >= 0
      SendMessage $StrigoiModelList ${LVM_GETITEMSTATE} $StrigoiSubagentIndex ${LVIS_STATEIMAGEMASK} $0
      IntOp $0 $0 & ${LVIS_STATEIMAGEMASK}
    ${Else}
      StrCpy $0 0
    ${EndIf}
    ${If} $0 == ${STRIGOI_LV_CHECKED}
    ${AndIf} $StrigoiSubagentInstalled != "1"
      ${If} $StrigoiModels == ""
        StrCpy $StrigoiModels "qwen3-4b-q4-k-m"
      ${Else}
        StrCpy $StrigoiModels "$StrigoiModels,qwen3-4b-q4-k-m"
      ${EndIf}
    ${EndIf}

  ; A instalação precisa sair com um modelo funcional. Alguns temas do NSIS
  ; não retornam corretamente o estado do checkbox preselecionado; nesse caso,
  ; preservamos a recomendação calculada a partir do hardware.
  ${If} $StrigoiModels == ""
  ${AndIf} $StrigoiInstallMode == "new"
    StrCpy $StrigoiModels "$StrigoiPreferredModel"
  ${EndIf}
FunctionEnd

Function StrigoiDetectInstalledModels
  StrCpy $StrigoiEssentialInstalled 0
  StrCpy $StrigoiLiteInstalled 0
  StrCpy $StrigoiBalancedInstalled 0
  StrCpy $StrigoiReasoningInstalled 0
  StrCpy $StrigoiAgentInstalled 0
  StrCpy $StrigoiSubagentInstalled 0
  IfFileExists "$StrigoiPreservedModels\qwen2.5-coder-3b-instruct-q4_k_m.gguf" 0 +2
    StrCpy $StrigoiEssentialInstalled 1
  IfFileExists "$StrigoiPreservedModels\qwen2.5-coder-7b-instruct-q4_k_m.gguf" 0 +2
    StrCpy $StrigoiLiteInstalled 1
  IfFileExists "$StrigoiPreservedModels\Qwen3-14B-Q4_K_M.gguf" 0 +2
    StrCpy $StrigoiBalancedInstalled 1
  IfFileExists "$StrigoiPreservedModels\gpt-oss-20b-MXFP4.gguf" 0 +2
    StrCpy $StrigoiReasoningInstalled 1
  IfFileExists "$StrigoiPreservedModels\qwen3-coder-30b-a3b-instruct-q8_0.gguf" 0 +2
    StrCpy $StrigoiAgentInstalled 1
  IfFileExists "$StrigoiPreservedModels\Qwen3-4B-Q4_K_M.gguf" 0 +2
    StrCpy $StrigoiSubagentInstalled 1
FunctionEnd

!macro customInstall
  ; Restore models before either maintenance mode or a new model download.
  IfFileExists "$StrigoiPreservedModels\*.*" 0 strigoi_restore_models_done
  RMDir /r "$INSTDIR\models"
  Rename "$StrigoiPreservedModels" "$INSTDIR\models"
strigoi_restore_models_done:
  ${If} $StrigoiInstallMode == "update"
    DetailPrint "Atualização selecionada: modelos locais preservados."
  ${ElseIf} $StrigoiModels != ""
    DetailPrint "Baixando os modelos locais selecionados: $StrigoiModels"
    File /oname=$PLUGINSDIR\strigoi-download-direct-models.ps1 "${BUILD_RESOURCES_DIR}\strigoi-download-direct-models.ps1"
    File /oname=$PLUGINSDIR\model-catalog.json "${BUILD_RESOURCES_DIR}\..\strigoi-core\src\node\model-catalog.json"
    Delete "$PLUGINSDIR\strigoi-model-download.ok"
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\strigoi-download-direct-models.ps1" -Models "$StrigoiModels" -ActiveModel "$StrigoiPreferredModel" -CatalogPath "$PLUGINSDIR\model-catalog.json" -DestinationDirectory "$INSTDIR\models" -RuntimeConfigPath "$INSTDIR\local-runtime.json" -LogPath "$INSTDIR\installer-model-download.log" -SuccessMarkerPath "$PLUGINSDIR\strigoi-model-download.ok" -ShowProgress'
    Pop $0
    ${If} $0 != "0"
    ${AndIfNot} ${FileExists} "$PLUGINSDIR\strigoi-model-download.ok"
      DetailPrint "Não foi possível baixar todos os modelos. Você poderá selecioná-los depois no Strigoi."
      MessageBox MB_ICONEXCLAMATION "O download de um ou mais modelos não foi concluído. O Strigoi continuará sem modelo até um download terminar. Consulte o registro em $INSTDIR\installer-model-download.log."
    ${EndIf}
  ${EndIf}
!macroend
!endif
