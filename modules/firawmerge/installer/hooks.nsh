!macro customInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\support\register.ps1" -AppDir "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "O menu do Explorador não pôde ser registrado (código $0). O aplicativo foi instalado."
  ${EndIf}
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\support\unregister.ps1"'
  Pop $0
!macroend
