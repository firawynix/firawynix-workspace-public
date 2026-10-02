!include "MUI2.nsh"
Unicode True

!ifndef BUNDLE_DIR
  !error "BUNDLE_DIR ausente"
!endif
!ifndef OUT_FILE
  !error "OUT_FILE ausente"
!endif

Name "Firawynix Workspace"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\FirawynixWorkspace"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Section "Instalar" SecMain
  SetOutPath "$INSTDIR"
  File /r "${BUNDLE_DIR}\*"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  CreateDirectory "$SMPROGRAMS\Firawynix Workspace"
  CreateShortcut "$SMPROGRAMS\Firawynix Workspace\Firawynix Workspace.lnk" "$INSTDIR\FirawynixMonitor.exe"
  CreateShortcut "$DESKTOP\Firawynix Workspace.lnk" "$INSTDIR\FirawynixMonitor.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FirawynixWorkspace" "DisplayName" "Firawynix Workspace"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FirawynixWorkspace" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FirawynixWorkspace" "InstallLocation" "$INSTDIR"
SectionEnd

Section "Uninstall"
  StrCmp $INSTDIR "$LOCALAPPDATA\Programs\FirawynixWorkspace" +2
  Abort "Diretório de instalação inesperado; desinstalação cancelada."
  Delete "$DESKTOP\Firawynix Workspace.lnk"
  Delete "$SMPROGRAMS\Firawynix Workspace\Firawynix Workspace.lnk"
  RMDir "$SMPROGRAMS\Firawynix Workspace"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FirawynixWorkspace"
  RMDir /r "$INSTDIR"
SectionEnd
