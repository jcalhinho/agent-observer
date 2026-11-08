; Agent Observer was called "RepoWatcher Agent Observer" before 0.15. Windows sees the new name as
; another program, so the NSIS installer removes the former one before installing. Its settings and
; history are kept: they live under the bundle identifier (dev.repowatcher.agentobserver), which did
; not change, and the former uninstaller only deletes them when its "delete app data" box is ticked,
; which the passive mode (/P) never does.

!define AO_LEGACY_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\RepoWatcher Agent Observer"

!macro NSIS_HOOK_PREINSTALL
  ; Both values are written quoted by the Tauri installer: "C:\...\uninstall.exe" and "C:\...".
  ReadRegStr $R9 HKCU "${AO_LEGACY_UNINSTKEY}" "UninstallString"
  ReadRegStr $R8 HKCU "${AO_LEGACY_UNINSTKEY}" "InstallLocation"
  ${If} $R9 != ""
  ${AndIf} $R8 != ""
    StrCpy $R6 $R9 1
    ${If} $R6 == '"'
      StrCpy $R9 $R9 "" 1
      StrCpy $R9 $R9 -1
    ${EndIf}
    StrCpy $R6 $R8 1
    ${If} $R6 == '"'
      StrCpy $R8 $R8 "" 1
      StrCpy $R8 $R8 -1
    ${EndIf}
    DetailPrint "Removing the former RepoWatcher Agent Observer"
    ; `_?=` runs the uninstaller in place, so ExecWait really waits for it.
    ExecWait '"$R9" /P _?=$R8' $R7
    ${If} $R7 = 0
      Delete "$R9"
      RMDir "$R8"
    ${EndIf}
  ${EndIf}
!macroend
