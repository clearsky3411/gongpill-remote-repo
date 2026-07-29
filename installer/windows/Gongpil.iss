#ifndef AppVersion
  #define AppVersion "0.1.1"
#endif
#ifndef AppNumericVersion
  #define AppNumericVersion "0.1.1.0"
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
Source: "{#AppSourceRoot}\portable.marker"; DestDir: "{app}"; DestName: "installed.marker"; Flags: ignoreversion

[Icons]
Name: "{group}\Gongpil"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Gongpil.vbs"""; WorkingDir: "{app}"
Name: "{group}\Gongpil 설정"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Gongpil.vbs"" --settings"; WorkingDir: "{app}"
Name: "{group}\Gongpil 제거"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Gongpil"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Gongpil.vbs"""; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\Gongpil.vbs"""; Description: "Gongpil 실행"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent runhidden

[UninstallDelete]
Type: filesandordirs; Name: "{app}\versions"

[Code]
var
  FontRootPage: TInputDirWizardPage;
  AppearancePage: TInputQueryWizardPage;
  UiScalePage: TInputOptionWizardPage;
  LastDefaultFontRoot: String;

function GetClientConfigRoot: String;
begin
  Result := ExpandFileName(AddBackslash(ExtractFileDir(ExpandConstant('{app}'))) + 'GongpilConfig');
end;

function GetDefaultFontRoot: String;
begin
  Result := AddBackslash(GetClientConfigRoot) + 'fonts';
end;

function GetParameterValue(const Name: String): String;
begin
  Result := Trim(ExpandConstant('{param:' + Name + '|}'));
end;

function GetFontRootValue: String;
var
  ParameterValue: String;
begin
  ParameterValue := GetParameterValue('GONGPILFONTROOT');
  if ParameterValue <> '' then
    Result := ParameterValue
  else if WizardSilent then
    Result := GetDefaultFontRoot
  else
    Result := FontRootPage.Values[0];
  StringChangeEx(Result, '/', '\', True);
  Result := ExpandFileName(Result);
end;

function GetFontSizeValue: Integer;
var
  Value: String;
begin
  Value := GetParameterValue('GONGPILFONTSIZE');
  if Value = '' then
    Value := AppearancePage.Values[0];
  Result := StrToIntDef(Value, -1);
end;

function GetWindowWidthValue: Integer;
var
  Value: String;
begin
  Value := GetParameterValue('GONGPILWINDOWWIDTH');
  if Value = '' then
    Value := AppearancePage.Values[1];
  Result := StrToIntDef(Value, -1);
end;

function GetWindowHeightValue: Integer;
var
  Value: String;
begin
  Value := GetParameterValue('GONGPILWINDOWHEIGHT');
  if Value = '' then
    Value := AppearancePage.Values[2];
  Result := StrToIntDef(Value, -1);
end;

function GetUiScaleValue: Integer;
var
  Value: String;
begin
  Value := GetParameterValue('GONGPILUISCALE');
  if Value <> '' then
  begin
    Result := StrToIntDef(Value, -1);
    Exit;
  end;
  case UiScalePage.SelectedValueIndex of
    0: Result := 80;
    1: Result := 90;
    2: Result := 100;
    3: Result := 110;
    4: Result := 125;
    5: Result := 150;
  else
    Result := -1;
  end;
end;

function IsAllowedUiScale(const Value: Integer): Boolean;
begin
  Result := (Value = 80) or (Value = 90) or (Value = 100) or
    (Value = 110) or (Value = 125) or (Value = 150);
end;

function ValidateFontRoot(var ErrorText: String): Boolean;
var
  AppRoot: String;
  AppRootPrefix: String;
  FontRoot: String;
begin
  FontRoot := GetFontRootValue;
  Result := (Length(FontRoot) >= 3) and (FontRoot[2] = ':') and (FontRoot[3] = '\');
  if not Result then
  begin
    ErrorText := 'Client Runtime 글꼴 폴더는 드라이브 문자를 포함한 절대 경로여야 합니다.';
    Exit;
  end;
  if Length(FontRoot) = 3 then
  begin
    ErrorText := '드라이브 루트는 Client Runtime 글꼴 폴더로 사용할 수 없습니다.';
    Result := False;
    Exit;
  end;
  AppRoot := ExpandFileName(ExpandConstant('{app}'));
  AppRootPrefix := AddBackslash(AppRoot);
  if (CompareText(FontRoot, AppRoot) = 0) or
    (CompareText(Copy(FontRoot, 1, Length(AppRootPrefix)), AppRootPrefix) = 0) then
  begin
    ErrorText := '설치 폴더 내부는 Client Runtime 글꼴 폴더로 사용할 수 없습니다.';
    Result := False;
    Exit;
  end;
  Result := True;
end;

function ValidateAppearance(var ErrorText: String): Boolean;
var
  FontSize: Integer;
  UiScale: Integer;
  WindowWidth: Integer;
  WindowHeight: Integer;
begin
  Result := ValidateFontRoot(ErrorText);
  if not Result then
    Exit;
  FontSize := GetFontSizeValue;
  if (FontSize < 8) or (FontSize > 24) then
  begin
    ErrorText := '기본 글자 크기는 8pt에서 24pt 사이의 정수여야 합니다.';
    Result := False;
    Exit;
  end;
  UiScale := GetUiScaleValue;
  if not IsAllowedUiScale(UiScale) then
  begin
    ErrorText := 'UI 배율은 80, 90, 100, 110, 125, 150 중 하나여야 합니다.';
    Result := False;
    Exit;
  end;
  WindowWidth := GetWindowWidthValue;
  if (WindowWidth < 640) or (WindowWidth > 2560) then
  begin
    ErrorText := '창 너비는 640 DIP에서 2560 DIP 사이여야 합니다.';
    Result := False;
    Exit;
  end;
  WindowHeight := GetWindowHeightValue;
  if (WindowHeight < 560) or (WindowHeight > 1600) then
  begin
    ErrorText := '창 높이는 560 DIP에서 1600 DIP 사이여야 합니다.';
    Result := False;
    Exit;
  end;
  Result := True;
end;

function JsonEscape(const Value: String): String;
begin
  Result := Value;
  StringChangeEx(Result, '\', '\\', True);
  StringChangeEx(Result, '"', '\"', True);
end;

procedure WriteAppearanceSeed;
var
  ConfigRoot: String;
  ErrorText: String;
  SeedContents: String;
  SeedPath: String;
  SettingsPath: String;
begin
  ConfigRoot := GetClientConfigRoot;
  SettingsPath := AddBackslash(ConfigRoot) + 'client-settings.json';
  SeedPath := AddBackslash(ConfigRoot) + 'client-settings-seed.json';
  if FileExists(SettingsPath) or FileExists(SeedPath) then
    Exit;
  if not ValidateAppearance(ErrorText) then
    RaiseException(ErrorText);
  if not ForceDirectories(ConfigRoot) then
    RaiseException('Client Runtime 설정 폴더를 만들 수 없습니다: ' + ConfigRoot);
  SeedContents :=
    '{' + #13#10 +
    '  "schemaVersion": 1,' + #13#10 +
    '  "appearance": {' + #13#10 +
    '    "baselineDpi": 96,' + #13#10 +
    '    "fontRoot": "' + JsonEscape(GetFontRootValue) + '",' + #13#10 +
    '    "uiFontId": "bundled:nanum-gothic",' + #13#10 +
    '    "monospaceFontId": "bundled:d2coding",' + #13#10 +
    '    "baseFontSizePt": ' + IntToStr(GetFontSizeValue) + ',' + #13#10 +
    '    "uiScalePercent": ' + IntToStr(GetUiScaleValue) + ',' + #13#10 +
    '    "windowWidthDip": ' + IntToStr(GetWindowWidthValue) + ',' + #13#10 +
    '    "windowHeightDip": ' + IntToStr(GetWindowHeightValue) + #13#10 +
    '  }' + #13#10 +
    '}' + #13#10;
  if not SaveStringToFile(SeedPath, SeedContents, False) then
    RaiseException('Client Runtime 화면 설정 시드를 저장할 수 없습니다: ' + SeedPath);
end;

procedure InitializeWizard;
begin
  FontRootPage := CreateInputDirPage(
    wpSelectDir,
    'Client Runtime 글꼴 폴더',
    '시스템에 글꼴을 설치하지 않고 이 폴더의 사용자 글꼴을 읽습니다.',
    '기본 포함 글꼴은 Client Package 안에 있으며, 이 폴더에는 나중에 추가할 .ttf, .otf, .ttc 파일을 둡니다.',
    False,
    '');
  FontRootPage.Add('사용자 글꼴 폴더:');

  AppearancePage := CreateInputQueryPage(
    FontRootPage.ID,
    'Client Runtime 화면 기준',
    '96 DPI 기준의 글자와 창 크기를 지정합니다.',
    '실제 화면에서는 Windows DPI와 UI 배율을 함께 적용합니다. 모든 값은 Client Runtime에서 다시 바꿀 수 있습니다.');
  AppearancePage.Add('기본 글자 크기 (8~24 pt):', False);
  AppearancePage.Add('창 너비 (640~2560 DIP):', False);
  AppearancePage.Add('창 높이 (560~1600 DIP):', False);
  AppearancePage.Values[0] := '9';
  AppearancePage.Values[1] := '760';
  AppearancePage.Values[2] := '720';

  UiScalePage := CreateInputOptionPage(
    AppearancePage.ID,
    'Client Runtime UI 배율',
    '사용자 UI 배율을 선택합니다.',
    'Windows 화면 배율과 별도로 적용되며 Client Runtime에서 나중에 변경할 수 있습니다.',
    True,
    False);
  UiScalePage.Add('80%');
  UiScalePage.Add('90%');
  UiScalePage.Add('100% (권장)');
  UiScalePage.Add('110%');
  UiScalePage.Add('125%');
  UiScalePage.Add('150%');
  UiScalePage.SelectedValueIndex := 2;
end;

procedure CurPageChanged(const CurPageID: Integer);
var
  CurrentDefault: String;
begin
  if CurPageID = FontRootPage.ID then
  begin
    CurrentDefault := GetDefaultFontRoot;
    if (FontRootPage.Values[0] = '') or (CompareText(FontRootPage.Values[0], LastDefaultFontRoot) = 0) then
      FontRootPage.Values[0] := CurrentDefault;
    LastDefaultFontRoot := CurrentDefault;
  end;
end;

function NextButtonClick(const CurPageID: Integer): Boolean;
var
  ErrorText: String;
begin
  Result := True;
  if (CurPageID = FontRootPage.ID) or (CurPageID = AppearancePage.ID) or (CurPageID = UiScalePage.ID) then
  begin
    Result := ValidateAppearance(ErrorText);
    if not Result then
      MsgBox(ErrorText, mbError, MB_OK);
  end;
end;

procedure CurStepChanged(const CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    WriteAppearanceSeed;
end;
