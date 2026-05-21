; MediaGrab — Inno Setup installer script
; Produces MediaGrab-Setup-X.Y.Z-win-x64.exe
; Installs to %LOCALAPPDATA%\Programs\MediaGrab (no admin needed)

#define MyAppName      "MediaGrab"
#define MyAppVersion   "1.0.0"
#define MyAppPublisher "MediaGrab"
#define MyAppExeName   "MediaGrab.exe"

[Setup]
AppId={{8F2A1B3C-7D4E-4F5A-9B6C-1A2B3C4D5E6F}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DisableProgramGroupPage=yes
DisableReadyPage=no
DisableDirPage=auto
DisableFinishedPage=no

; Output
OutputDir=dist
OutputBaseFilename=MediaGrab-Setup-{#MyAppVersion}-win-x64
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes

; UI
WizardStyle=modern
WizardSizePercent=120
ShowLanguageDialog=no
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=assets\icon.ico

; Architecture
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; Versioning info shown in Windows file properties
VersionInfoVersion={#MyAppVersion}.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription=MediaGrab — Universal Video Downloader
VersionInfoProductName={#MyAppName}

[Languages]
Name: "english";  MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut (建立桌面捷徑)"; GroupDescription: "Additional shortcuts (額外捷徑):"

[Files]
; Drop the entire payload tree into {app}\
Source: "payload\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
; Optional: add Defender exclusion so yt-dlp.exe isn't blocked (silently fails if PowerShell or AV blocks it)
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Add-MpPreference -ExclusionPath '{app}' -ErrorAction SilentlyContinue"""; Flags: runhidden skipifsilent

; Auto-launch after install
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName} now (立即啟動)"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean up logs/pid created at runtime
Type: filesandordirs; Name: "{localappdata}\MediaGrab"

[Code]
// Kill any running MediaGrab.exe / node.exe spawned by it before uninstall
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then begin
    Exec('taskkill.exe', '/F /IM MediaGrab.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec('taskkill.exe', '/F /IM node.exe',      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
