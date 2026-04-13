; TuneSalon Desktop NSIS Installer
; Bundles Tauri app + Python sidecar

!include "MUI2.nsh"
!include "Sections.nsh"

; General
Name "TuneSalon Desktop"
OutFile "TuneSalon-Desktop-0.1.1-setup.exe"
InstallDir "$LOCALAPPDATA\TuneSalon Desktop"
RequestExecutionLevel user

; UI
!define MUI_ICON "src-tauri\icons\icon.ico"
!define MUI_UNICON "src-tauri\icons\icon.ico"
!define MUI_ABORTWARNING

; Pages
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ─── Required components ─────────────────────────────────────────────────────

SectionGroup /e "Required" SecGrpRequired

    Section "TuneSalon Desktop" SecApp
        SectionIn RO
        SetOutPath "$INSTDIR"
        File "installer_dist\TuneSalon Desktop\TuneSalon Desktop.exe"
        SetOutPath "$INSTDIR\python"
        File /r "installer_dist\TuneSalon Desktop\python\*.*"
        SetOutPath "$INSTDIR"

        ; Start menu shortcuts
        CreateDirectory "$SMPROGRAMS\TuneSalon Desktop"
        CreateShortcut "$SMPROGRAMS\TuneSalon Desktop\TuneSalon Desktop.lnk" "$INSTDIR\TuneSalon Desktop.exe" "" "$INSTDIR\TuneSalon Desktop.exe"
        CreateShortcut "$SMPROGRAMS\TuneSalon Desktop\Uninstall.lnk" "$INSTDIR\uninstall.exe"

        ; Uninstaller
        WriteUninstaller "$INSTDIR\uninstall.exe"

        ; Registry for Add/Remove Programs
        WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TuneSalon Desktop" "DisplayName" "TuneSalon Desktop"
        WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TuneSalon Desktop" "UninstallString" '"$INSTDIR\uninstall.exe"'
        WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TuneSalon Desktop" "DisplayIcon" "$INSTDIR\TuneSalon Desktop.exe"
        WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TuneSalon Desktop" "Publisher" "TuneSalon"
        WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TuneSalon Desktop" "DisplayVersion" "0.1.1"
    SectionEnd

    Section "Python 3.10+" SecPython
        SectionIn RO
        ; Not bundled — must be pre-installed by user
    SectionEnd

    Section "PyTorch + CUDA (~2.5 GB)" SecTorch
        SectionIn RO
        ; Installed on first app launch if missing
    SectionEnd

SectionGroupEnd

; ─── Optional components ─────────────────────────────────────────────────────

SectionGroup /e "Optional" SecGrpOptional

    Section "Desktop Shortcut" SecDesktop
        CreateShortcut "$DESKTOP\TuneSalon Desktop.lnk" "$INSTDIR\TuneSalon Desktop.exe" "" "$INSTDIR\TuneSalon Desktop.exe"
    SectionEnd

    Section "Docling - PDF/document support (~500 MB)" SecDocling
        ; Selection saved to config below
    SectionEnd

    Section "llama-cpp-python - GGUF chat (~100 MB)" SecLlama
        ; Selection saved to config below
    SectionEnd

SectionGroupEnd

; ─── Detect already-installed packages on init ───────────────────────────────

Function .onInit
    ; Find Python and check for installed packages
    nsExec::ExecToStack 'python -c "import docling"'
    Pop $0  ; exit code
    Pop $1  ; output
    ${If} $0 == 0
        ; Docling already installed — lock section and update label
        !insertmacro SetSectionFlag ${SecDocling} ${SF_RO}
        !insertmacro SelectSection ${SecDocling}
        SectionSetText ${SecDocling} "Docling - PDF/document support (installed)"
    ${EndIf}

    nsExec::ExecToStack 'python -c "import llama_cpp"'
    Pop $0
    Pop $1
    ${If} $0 == 0
        ; llama-cpp-python already installed — lock section and update label
        !insertmacro SetSectionFlag ${SecLlama} ${SF_RO}
        !insertmacro SelectSection ${SecLlama}
        SectionSetText ${SecLlama} "llama-cpp-python - GGUF chat (installed)"
    ${EndIf}
FunctionEnd

; ─── Save optional dependency selections ─────────────────────────────────────

Function .onInstSuccess
    ; Write user's optional dependency choices so the app knows what to install
    FileOpen $0 "$INSTDIR\install_options.ini" w
    ${If} ${SectionIsSelected} ${SecDocling}
        FileWrite $0 "docling=yes$\r$\n"
    ${Else}
        FileWrite $0 "docling=no$\r$\n"
    ${EndIf}
    ${If} ${SectionIsSelected} ${SecLlama}
        FileWrite $0 "llama_cpp=yes$\r$\n"
    ${Else}
        FileWrite $0 "llama_cpp=no$\r$\n"
    ${EndIf}
    FileClose $0
FunctionEnd

; ─── Section descriptions ────────────────────────────────────────────────────

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${SecApp} "The main application and AI engine. Includes the desktop app and Python backend for model training and chat."
    !insertmacro MUI_DESCRIPTION_TEXT ${SecPython} "Python 3.10 or later is required. Please install from python.org before launching the app."
    !insertmacro MUI_DESCRIPTION_TEXT ${SecTorch} "GPU-accelerated AI framework. Automatically installed on first launch if not already present."
    !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Create a shortcut on your Desktop for quick access."
    !insertmacro MUI_DESCRIPTION_TEXT ${SecDocling} "Enables uploading PDFs and documents for AI-powered chat (RAG). Installed on first launch if selected."
    !insertmacro MUI_DESCRIPTION_TEXT ${SecLlama} "Enables fast, lightweight chat with exported GGUF models. Installed on first launch if selected."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ─── Uninstaller ─────────────────────────────────────────────────────────────

Section "Uninstall"
    ; Remove files
    RMDir /r "$INSTDIR\python"
    Delete "$INSTDIR\TuneSalon Desktop.exe"
    Delete "$INSTDIR\install_options.ini"
    Delete "$INSTDIR\uninstall.exe"
    RMDir "$INSTDIR"

    ; Remove WebView2 cache and localStorage (fresh state on reinstall)
    RMDir /r "$LOCALAPPDATA\com.tunesalon.desktop"

    ; Remove shortcuts
    Delete "$SMPROGRAMS\TuneSalon Desktop\TuneSalon Desktop.lnk"
    Delete "$SMPROGRAMS\TuneSalon Desktop\Uninstall.lnk"
    RMDir "$SMPROGRAMS\TuneSalon Desktop"
    Delete "$DESKTOP\TuneSalon Desktop.lnk"

    ; Remove registry
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TuneSalon Desktop"
SectionEnd
