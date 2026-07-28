#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef AppNumericVersion
  #define AppNumericVersion "0.1.0.0"
#endif
#ifndef AppSourceRoot
  #error AppSourceRoot define is required
#endif

[Setup]
AppId={{5C86E8B0-2E58-4C56-A52A-530224BA5592}
AppName=Gongpil
AppVersion={#AppVersion}
AppVerName=Gongpil {#AppVersion}
AppPublisher=Gongpil Contributors
DefaultDirName={localappdata}\Programs\Gongpil
DefaultGroupName=Gongpil
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
OutputBaseFilename=Gongpil-{#AppVersion}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
SetupLogging=yes
Uninstallable=yes
UninstallDisplayName=Gongpil {#AppVersion}
VersionInfoVersion={#AppNumericVersion}
VersionInfoDescription=Gongpil Windows Installer
VersionInfoProductName=Gongpil
VersionInfoProductVersion={#AppVersion}

[Tasks]
Name: "desktopicon"; Description: "바탕 화면 바로가기 만들기"; GroupDescription: "추가 바로가기:"; Flags: unchecked

[Files]
Source: "{#AppSourceRoot}\*"; DestDir: "{app}"; Excludes: "portable.marker,GongpilData\*"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Gongpil"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Gongpil.vbs"""; WorkingDir: "{app}"
Name: "{group}\공필 데이터 폴더"; Filename: "{localappdata}\Gongpil"
Name: "{group}\Gongpil 제거"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Gongpil"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Gongpil.vbs"""; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\Gongpil.vbs"""; Description: "Gongpil 실행"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{app}\versions"
