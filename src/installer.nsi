Unicode true
!include "MUI2.nsh"
Name "ZapCut v1.7.1 for Premiere Pro"
OutFile "Install_ZapCut_v1.7.1.1.exe"
RequestExecutionLevel user
InstallDir "$APPDATA\Adobe\CEP\extensions\ZapCut"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

Section
  RMDir /r "$APPDATA\Adobe\CEP\extensions\MuteGroserias"
  RMDir /r "$APPDATA\Adobe\CEP\extensions\Bleepify"
  SetOutPath "$INSTDIR"
  File /r "ext\*.*"
  WriteRegStr HKCU "Software\Adobe\CSXS.9"  "PlayerDebugMode" "1"
  WriteRegStr HKCU "Software\Adobe\CSXS.10" "PlayerDebugMode" "1"
  WriteRegStr HKCU "Software\Adobe\CSXS.11" "PlayerDebugMode" "1"
  WriteRegStr HKCU "Software\Adobe\CSXS.12" "PlayerDebugMode" "1"
  DetailPrint "Instalando el motor de analisis (necesita internet, unos minutos)..."
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\engine\setup.ps1"'
  MessageBox MB_OK "Listo. Reinicia Premiere y abre: Ventana > Extensiones > ZapCut"
SectionEnd
