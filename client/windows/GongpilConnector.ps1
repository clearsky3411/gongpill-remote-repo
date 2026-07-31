[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [ValidateSet('Start', 'Cancel', 'ProbeShown')][string]$AutomationAction
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class GongpilDpiAwareness
{
    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    public static void Enable()
    {
        try
        {
            if (SetProcessDpiAwarenessContext(new IntPtr(-4)))
            {
                return;
            }
        }
        catch (EntryPointNotFoundException)
        {
        }

        try
        {
            SetProcessDPIAware();
        }
        catch (EntryPointNotFoundException)
        {
        }
    }
}
'@
[GongpilDpiAwareness]::Enable()
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$inputModel = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json

function Get-ClientFontRuntime {
    param(
        [Parameter(Mandatory = $true)]$FontCatalog,
        [Parameter(Mandatory = $true)]$UserFontFiles
    )

    $collection = New-Object System.Drawing.Text.PrivateFontCollection
    $options = @()
    $warnings = @()
    foreach ($font in @($FontCatalog.fonts)) {
        $probe = New-Object System.Drawing.Text.PrivateFontCollection
        try {
            foreach ($file in @($font.files)) {
                $fontPath = [System.IO.Path]::Combine([string]$FontCatalog.fontsRoot, [string]$file.fileName)
                $probe.AddFontFile($fontPath)
                $collection.AddFontFile($fontPath)
            }
            $family = @($probe.Families | Where-Object { $_.Name -eq [string]$font.preferredFamily }) | Select-Object -First 1
            if ($null -eq $family) {
                $family = @($probe.Families | Sort-Object Name) | Select-Object -First 1
            }
            if ($null -eq $family) {
                throw "글꼴 패밀리를 찾지 못했습니다: $($font.preferredFamily)"
            }
            $options += [pscustomobject]@{
                Id = "bundled:$($font.id)"
                DisplayName = "$($font.displayName) (포함)"
                FamilyName = $family.Name
                Role = [string]$font.role
            }
        }
        catch {
            $warnings += "$($font.displayName): $($_.Exception.Message)"
        }
        finally {
            $probe.Dispose()
        }
    }
    foreach ($file in @($UserFontFiles)) {
        $probe = New-Object System.Drawing.Text.PrivateFontCollection
        try {
            $probe.AddFontFile([string]$file.path)
            $family = @($probe.Families | Sort-Object Name) | Select-Object -First 1
            if ($null -eq $family) {
                throw '글꼴 패밀리를 찾지 못했습니다.'
            }
            $collection.AddFontFile([string]$file.path)
            $options += [pscustomobject]@{
                Id = [string]$file.id
                DisplayName = "$($family.Name) (사용자)"
                FamilyName = $family.Name
                Role = 'user'
            }
        }
        catch {
            $warnings += "$($file.fileName): $($_.Exception.Message)"
        }
        finally {
            $probe.Dispose()
        }
    }
    return [pscustomobject]@{
        Collection = $collection
        Options = @($options)
        Warnings = @($warnings)
    }
}

function Get-SelectedFontOption {
    param(
        [Parameter(Mandatory = $true)]$Options,
        [Parameter(Mandatory = $true)][string]$SelectedId,
        [Parameter(Mandatory = $true)][string]$FallbackId
    )

    $selected = @($Options | Where-Object { $_.Id -eq $SelectedId }) | Select-Object -First 1
    if ($null -eq $selected) {
        $selected = @($Options | Where-Object { $_.Id -eq $FallbackId }) | Select-Object -First 1
    }
    if ($null -eq $selected) {
        $availableIds = @($Options | ForEach-Object { $_.Id }) -join ', '
        throw "Client Package 기본 글꼴을 불러오지 못했습니다: $FallbackId (available=$availableIds)"
    }
    return $selected
}

function New-ClientFont {
    param(
        [Parameter(Mandatory = $true)][System.Drawing.FontFamily]$Family,
        [Parameter(Mandatory = $true)][single]$Size,
        [Parameter(Mandatory = $true)][System.Drawing.FontStyle]$Style
    )

    $resolvedStyle = if ($Family.IsStyleAvailable($Style)) { $Style } else { [System.Drawing.FontStyle]::Regular }
    return New-Object System.Drawing.Font -ArgumentList @($Family, $Size, $resolvedStyle, [System.Drawing.GraphicsUnit]::Point)
}

function Resolve-HttpsConfigUrl {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $trimmed = $Value.Trim()
    $uri = $null
    if (
        $trimmed.Length -gt 2048 -or
        -not [System.Uri]::TryCreate($trimmed, [System.UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne 'https' -or
        [string]::IsNullOrWhiteSpace($uri.Host) -or
        -not [string]::IsNullOrEmpty($uri.UserInfo) -or
        -not [string]::IsNullOrEmpty($uri.Query) -or
        -not [string]::IsNullOrEmpty($uri.Fragment)
    ) {
        throw "$Label URL은 인증정보·query·fragment가 없는 HTTPS 주소여야 합니다."
    }
    return $uri.AbsoluteUri
}

function Resolve-GitBranch {
    param([Parameter(Mandatory = $true)][string]$Value)

    $branch = $Value.Trim()
    if (
        $branch -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$' -or
        $branch.Contains('..') -or
        $branch.Contains('//') -or
        $branch.Contains('@{') -or
        $branch.EndsWith('.') -or
        $branch.EndsWith('/')
    ) {
        throw 'Source Repository 기본 브랜치가 올바르지 않습니다.'
    }
    return $branch
}

$isPortable = $inputModel.mode -eq 'portable'
$lifecycleReason = if ($null -eq $inputModel.PSObject.Properties['lifecycleReason']) { 'startup' } else { [string]$inputModel.lifecycleReason }
$releaseNotes = if ($null -eq $inputModel.PSObject.Properties['releaseNotes']) {
    [pscustomobject]@{
        productVersion = '0.1.1'
        releasedAt = ''
        title = '공필 클라이언트'
        summary = '인스턴스를 시작하고 설정할 수 있습니다.'
        capabilities = @('프로젝트와 문서 작업')
        changes = @('클라이언트 홈을 준비했습니다.')
    }
}
else {
    $inputModel.releaseNotes
}
$resultAction = 'cancel'
$appearance = $inputModel.settings.appearance
$fontRuntime = Get-ClientFontRuntime -FontCatalog $inputModel.fontCatalog -UserFontFiles $inputModel.userFontFiles
try {
    $uiFontOption = Get-SelectedFontOption -Options $fontRuntime.Options -SelectedId ([string]$appearance.uiFontId) -FallbackId 'bundled:nanum-gothic'
}
catch {
    throw "$($_.Exception.Message) warnings=$(@($fontRuntime.Warnings) -join ' | ')"
}
$monospaceFontOption = Get-SelectedFontOption -Options $fontRuntime.Options -SelectedId ([string]$appearance.monospaceFontId) -FallbackId 'bundled:d2coding'
$uiFontFamily = @($fontRuntime.Collection.Families | Where-Object { $_.Name -eq $uiFontOption.FamilyName }) | Select-Object -First 1
$baseFontSizePt = [single]$appearance.baseFontSizePt
$uiScale = [single]$appearance.uiScalePercent / 100.0
$ownedFonts = @()

$form = New-Object System.Windows.Forms.Form
$form.Text = "공필 클라이언트 $($releaseNotes.productVersion)"
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
$form.AutoScaleDimensions = New-Object System.Drawing.SizeF(96, 96)
$form.AutoScroll = $true
$form.ClientSize = New-Object System.Drawing.Size([int]$appearance.windowWidthDip, [int]$appearance.windowHeightDip)
$baseFont = New-ClientFont -Family $uiFontFamily -Size $baseFontSizePt -Style ([System.Drawing.FontStyle]::Regular)
$ownedFonts += $baseFont
$form.Font = $baseFont

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = if ($inputModel.isFirstRun) {
    '처음 사용할 위치를 정해주세요.'
}
elseif ($lifecycleReason -eq 'instance-crashed') {
    '인스턴스가 비정상 종료되었습니다.'
}
elseif ($lifecycleReason -eq 'instance-stopped') {
    '인스턴스가 종료되었습니다. 클라이언트는 실행 중입니다.'
}
else {
    '인스턴스를 시작하거나 저장 위치를 바꿀 수 있습니다.'
}
$titleFont = New-ClientFont -Family $uiFontFamily -Size 14 -Style ([System.Drawing.FontStyle]::Bold)
$ownedFonts += $titleFont
$titleLabel.Font = $titleFont
$titleLabel.AutoSize = $true
$titleLabel.Location = New-Object System.Drawing.Point(24, 22)
$form.Controls.Add($titleLabel)

$modeLabel = New-Object System.Windows.Forms.Label
$modeLabel.Text = if ($isPortable) { '실행 방식: 포터블 (데이터 위치 고정)' } else { '실행 방식: 설치형' }
$modeLabel.AutoSize = $true
$modeLabel.ForeColor = [System.Drawing.Color]::DimGray
$modeLabel.Location = New-Object System.Drawing.Point(27, 62)
$form.Controls.Add($modeLabel)

$tabControl = New-Object System.Windows.Forms.TabControl
$tabControl.Location = New-Object System.Drawing.Point(20, 90)
$tabControl.Size = New-Object System.Drawing.Size(720, 535)
$form.Controls.Add($tabControl)

$homeTab = New-Object System.Windows.Forms.TabPage
$homeTab.Text = '홈'
$homeTab.BackColor = [System.Drawing.Color]::White
$tabControl.TabPages.Add($homeTab)

$settingsTab = New-Object System.Windows.Forms.TabPage
$settingsTab.Text = '설정'
$settingsTab.BackColor = [System.Drawing.Color]::White
$tabControl.TabPages.Add($settingsTab)

$systemTab = New-Object System.Windows.Forms.TabPage
$systemTab.Text = '시스템'
$systemTab.BackColor = [System.Drawing.Color]::White
$tabControl.TabPages.Add($systemTab)

$appearanceTab = New-Object System.Windows.Forms.TabPage
$appearanceTab.Text = '화면'
$appearanceTab.BackColor = [System.Drawing.Color]::White
$tabControl.TabPages.Add($appearanceTab)

$infoTab = New-Object System.Windows.Forms.TabPage
$infoTab.Text = '정보'
$infoTab.BackColor = [System.Drawing.Color]::White
$tabControl.TabPages.Add($infoTab)

$runtimeGroup = New-Object System.Windows.Forms.GroupBox
$runtimeGroup.Text = '현재 상태'
$runtimeGroup.Location = New-Object System.Drawing.Point(18, 18)
$runtimeGroup.Size = New-Object System.Drawing.Size(674, 100)
$homeTab.Controls.Add($runtimeGroup)

$runtimeStatusLabel = New-Object System.Windows.Forms.Label
$runtimeStatusLabel.Text = 'Client Runtime 실행 중'
$runtimeStatusFont = New-ClientFont -Family $uiFontFamily -Size 12 -Style ([System.Drawing.FontStyle]::Bold)
$ownedFonts += $runtimeStatusFont
$runtimeStatusLabel.Font = $runtimeStatusFont
$runtimeStatusLabel.ForeColor = [System.Drawing.Color]::SeaGreen
$runtimeStatusLabel.AutoSize = $true
$runtimeStatusLabel.Location = New-Object System.Drawing.Point(16, 24)
$runtimeGroup.Controls.Add($runtimeStatusLabel)

$instanceStatusLabel = New-Object System.Windows.Forms.Label
$instanceStatusLabel.Text = if ($lifecycleReason -eq 'instance-crashed') {
    'Instance Runtime: 비정상 종료 · 다시 시작할 수 있습니다.'
}
elseif ($lifecycleReason -eq 'instance-stopped') {
    'Instance Runtime: 종료됨 · 다시 시작할 수 있습니다.'
}
else {
    'Instance Runtime: 시작 대기 중'
}
$instanceStatusLabel.AutoSize = $true
$instanceStatusLabel.Location = New-Object System.Drawing.Point(18, 59)
$runtimeGroup.Controls.Add($instanceStatusLabel)

$versionLabel = New-Object System.Windows.Forms.Label
$versionLabel.Text = "버전 $($releaseNotes.productVersion) · $($releaseNotes.releasedAt)"
$versionLabel.AutoSize = $true
$versionLabel.ForeColor = [System.Drawing.Color]::DimGray
$versionLabel.Location = New-Object System.Drawing.Point(500, 28)
$runtimeGroup.Controls.Add($versionLabel)

$capabilityLabel = New-Object System.Windows.Forms.Label
$capabilityLabel.Text = '지금 가능한 작업'
$sectionFont = New-ClientFont -Family $uiFontFamily -Size 10 -Style ([System.Drawing.FontStyle]::Bold)
$ownedFonts += $sectionFont
$capabilityLabel.Font = $sectionFont
$capabilityLabel.AutoSize = $true
$capabilityLabel.Location = New-Object System.Drawing.Point(18, 138)
$homeTab.Controls.Add($capabilityLabel)

$capabilityBox = New-Object System.Windows.Forms.RichTextBox
$capabilityBox.ReadOnly = $true
$capabilityBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$capabilityBox.BackColor = [System.Drawing.Color]::WhiteSmoke
$capabilityBox.Location = New-Object System.Drawing.Point(18, 164)
$capabilityBox.Size = New-Object System.Drawing.Size(674, 145)
$capabilityBox.Text = (@($releaseNotes.capabilities | ForEach-Object { "• $_" }) -join "`r`n")
$homeTab.Controls.Add($capabilityBox)

$changesLabel = New-Object System.Windows.Forms.Label
$changesLabel.Text = "패치노트 · $($releaseNotes.title)"
$changesLabel.Font = $sectionFont
$changesLabel.AutoSize = $true
$changesLabel.Location = New-Object System.Drawing.Point(18, 329)
$homeTab.Controls.Add($changesLabel)

$summaryLabel = New-Object System.Windows.Forms.Label
$summaryLabel.Text = [string]$releaseNotes.summary
$summaryLabel.AutoEllipsis = $true
$summaryLabel.Location = New-Object System.Drawing.Point(18, 355)
$summaryLabel.Size = New-Object System.Drawing.Size(674, 40)
$homeTab.Controls.Add($summaryLabel)

$changesBox = New-Object System.Windows.Forms.RichTextBox
$changesBox.ReadOnly = $true
$changesBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
$changesBox.BackColor = [System.Drawing.Color]::WhiteSmoke
$changesBox.Location = New-Object System.Drawing.Point(18, 400)
$changesBox.Size = New-Object System.Drawing.Size(674, 88)
$changesBox.Text = (@($releaseNotes.changes | ForEach-Object { "• $_" }) -join "`r`n")
$homeTab.Controls.Add($changesBox)

$dataLabel = New-Object System.Windows.Forms.Label
$dataLabel.Text = '공필 데이터 폴더'
$dataLabel.AutoSize = $true
$dataLabel.Location = New-Object System.Drawing.Point(27, 101)
$form.Controls.Add($dataLabel)

$dataTextBox = New-Object System.Windows.Forms.TextBox
$dataTextBox.Text = [string]$inputModel.settings.dataRoot
$dataTextBox.Location = New-Object System.Drawing.Point(30, 124)
$dataTextBox.Size = New-Object System.Drawing.Size(500, 27)
$dataTextBox.ReadOnly = $isPortable
$form.Controls.Add($dataTextBox)

$browseButton = New-Object System.Windows.Forms.Button
$browseButton.Text = '찾아보기...'
$browseButton.Location = New-Object System.Drawing.Point(540, 122)
$browseButton.Size = New-Object System.Drawing.Size(94, 31)
$browseButton.Enabled = -not $isPortable
$browseButton.Add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = '공필 프로젝트와 문서를 저장할 폴더를 선택하세요.'
    $dialog.ShowNewFolderButton = $true
    if ([System.IO.Directory]::Exists($dataTextBox.Text)) {
        $dialog.SelectedPath = $dataTextBox.Text
    }
    if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
        $dataTextBox.Text = $dialog.SelectedPath
    }
    $dialog.Dispose()
})
$form.Controls.Add($browseButton)

$warningLabel = New-Object System.Windows.Forms.Label
$warningLabel.Text = '경로를 바꾸어도 기존 데이터는 자동으로 이동하지 않습니다. 새 경로의 데이터로 인스턴스가 열립니다.'
$warningLabel.AutoSize = $true
$warningLabel.ForeColor = [System.Drawing.Color]::DarkGoldenrod
$warningLabel.Location = New-Object System.Drawing.Point(27, 160)
$form.Controls.Add($warningLabel)

$providerLabel = New-Object System.Windows.Forms.Label
$providerLabel.Text = 'AI 연결 방식'
$providerLabel.AutoSize = $true
$providerLabel.Location = New-Object System.Drawing.Point(27, 195)
$form.Controls.Add($providerLabel)

$providerComboBox = New-Object System.Windows.Forms.ComboBox
$providerComboBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$null = $providerComboBox.Items.Add('Codex Pro (ChatGPT 로그인)')
$null = $providerComboBox.Items.Add('OpenAI API (별도 과금)')
$configuredProvider = if ($null -eq $inputModel.settings.PSObject.Properties['aiProvider']) { 'codex' } else { [string]$inputModel.settings.aiProvider }
$providerComboBox.SelectedIndex = if ($configuredProvider -eq 'openai-api') { 1 } else { 0 }
$providerComboBox.Location = New-Object System.Drawing.Point(30, 218)
$providerComboBox.Size = New-Object System.Drawing.Size(300, 27)
$form.Controls.Add($providerComboBox)

$codexLabel = New-Object System.Windows.Forms.Label
$codexLabel.Text = 'Codex 실행 파일 (비우면 자동 검색)'
$codexLabel.AutoSize = $true
$codexLabel.Location = New-Object System.Drawing.Point(27, 260)
$form.Controls.Add($codexLabel)

$codexTextBox = New-Object System.Windows.Forms.TextBox
$codexTextBox.Text = if ($null -eq $inputModel.settings.PSObject.Properties['codexExecutable']) { '' } else { [string]$inputModel.settings.codexExecutable }
$codexTextBox.Location = New-Object System.Drawing.Point(30, 283)
$codexTextBox.Size = New-Object System.Drawing.Size(500, 27)
$form.Controls.Add($codexTextBox)

$codexBrowseButton = New-Object System.Windows.Forms.Button
$codexBrowseButton.Text = '파일 선택...'
$codexBrowseButton.Location = New-Object System.Drawing.Point(540, 281)
$codexBrowseButton.Size = New-Object System.Drawing.Size(94, 31)
$codexBrowseButton.Add_Click({
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Codex 실행 파일을 선택하세요.'
    $dialog.Filter = '실행 파일 (codex.exe)|codex.exe|모든 파일 (*.*)|*.*'
    $dialog.CheckFileExists = $true
    if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
        $codexTextBox.Text = $dialog.FileName
    }
    $dialog.Dispose()
})
$form.Controls.Add($codexBrowseButton)

$codexModelLabel = New-Object System.Windows.Forms.Label
$codexModelLabel.Text = 'Codex 모델'
$codexModelLabel.AutoSize = $true
$codexModelLabel.Location = New-Object System.Drawing.Point(27, 325)
$form.Controls.Add($codexModelLabel)

$codexModelComboBox = New-Object System.Windows.Forms.ComboBox
$codexModelComboBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDown
$codexModelComboBox.Items.AddRange(@('gpt-5.6-terra', 'gpt-5.6-sol'))
$configuredCodexModel = if ($null -eq $inputModel.settings.PSObject.Properties['codexModel']) { '' } else { [string]$inputModel.settings.codexModel }
$codexModelComboBox.Text = if ([string]::IsNullOrWhiteSpace($configuredCodexModel)) { 'gpt-5.6-terra' } else { $configuredCodexModel }
$codexModelComboBox.Location = New-Object System.Drawing.Point(30, 348)
$codexModelComboBox.Size = New-Object System.Drawing.Size(260, 27)
$form.Controls.Add($codexModelComboBox)

$apiLabel = New-Object System.Windows.Forms.Label
$apiLabel.Text = 'OpenAI API 환경파일 (.env.local, 별도 과금)'
$apiLabel.AutoSize = $true
$apiLabel.Location = New-Object System.Drawing.Point(27, 390)
$form.Controls.Add($apiLabel)

$apiTextBox = New-Object System.Windows.Forms.TextBox
$apiTextBox.Text = if ($null -eq $inputModel.settings.PSObject.Properties['openAiEnvFile']) { '' } else { [string]$inputModel.settings.openAiEnvFile }
$apiTextBox.Location = New-Object System.Drawing.Point(30, 413)
$apiTextBox.Size = New-Object System.Drawing.Size(500, 27)
$form.Controls.Add($apiTextBox)

$apiBrowseButton = New-Object System.Windows.Forms.Button
$apiBrowseButton.Text = '파일 선택...'
$apiBrowseButton.Location = New-Object System.Drawing.Point(540, 411)
$apiBrowseButton.Size = New-Object System.Drawing.Size(94, 31)
$apiBrowseButton.Add_Click({
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'OPENAI_API_KEY가 저장된 환경파일을 선택하세요.'
    $dialog.Filter = '환경파일 (.env.local)|.env.local|모든 파일 (*.*)|*.*'
    $dialog.CheckFileExists = $true
    if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
        $apiTextBox.Text = $dialog.FileName
    }
    $dialog.Dispose()
})
$form.Controls.Add($apiBrowseButton)

$modelLabel = New-Object System.Windows.Forms.Label
$modelLabel.Text = 'OpenAI API 모델'
$modelLabel.AutoSize = $true
$modelLabel.Location = New-Object System.Drawing.Point(27, 455)
$form.Controls.Add($modelLabel)

$modelComboBox = New-Object System.Windows.Forms.ComboBox
$modelComboBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDown
$modelComboBox.Items.AddRange(@('gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna'))
$configuredModel = if ($null -eq $inputModel.settings.PSObject.Properties['openAiModel']) { '' } else { [string]$inputModel.settings.openAiModel }
$modelComboBox.Text = if ([string]::IsNullOrWhiteSpace($configuredModel)) { 'gpt-5.6-terra' } else { $configuredModel }
$modelComboBox.Location = New-Object System.Drawing.Point(30, 478)
$modelComboBox.Size = New-Object System.Drawing.Size(260, 27)
$form.Controls.Add($modelComboBox)

$startupCheckBox = New-Object System.Windows.Forms.CheckBox
$startupCheckBox.Text = '다음 실행에도 이 접속기 창을 먼저 표시'
$startupCheckBox.Checked = [bool]$inputModel.settings.showConnectorOnStartup
$startupCheckBox.AutoSize = $true
$startupCheckBox.Location = New-Object System.Drawing.Point(30, 522)
$form.Controls.Add($startupCheckBox)

$settingsControls = @(
    $dataLabel, $dataTextBox, $browseButton, $warningLabel,
    $providerLabel, $providerComboBox,
    $codexLabel, $codexTextBox, $codexBrowseButton,
    $codexModelLabel, $codexModelComboBox,
    $apiLabel, $apiTextBox, $apiBrowseButton,
    $modelLabel, $modelComboBox, $startupCheckBox
)
foreach ($control in $settingsControls) {
    $control.Top -= 80
    $settingsTab.Controls.Add($control)
}

$repositoryGroup = New-Object System.Windows.Forms.GroupBox
$repositoryGroup.Text = '저장소 기준'
$repositoryGroup.Location = New-Object System.Drawing.Point(18, 18)
$repositoryGroup.Size = New-Object System.Drawing.Size(674, 310)
$systemTab.Controls.Add($repositoryGroup)

$sourceRepositoryLabel = New-Object System.Windows.Forms.Label
$sourceRepositoryLabel.Text = 'Source Repository · 개발 패키지 소스와 변경 이력'
$sourceRepositoryLabel.AutoSize = $true
$sourceRepositoryLabel.Location = New-Object System.Drawing.Point(16, 30)
$repositoryGroup.Controls.Add($sourceRepositoryLabel)

$sourceRepositoryTextBox = New-Object System.Windows.Forms.TextBox
$sourceRepositoryTextBox.Text = [string]$inputModel.settings.repositories.source.url
$sourceRepositoryTextBox.Location = New-Object System.Drawing.Point(18, 53)
$sourceRepositoryTextBox.Size = New-Object System.Drawing.Size(626, 27)
$repositoryGroup.Controls.Add($sourceRepositoryTextBox)

$sourceBranchLabel = New-Object System.Windows.Forms.Label
$sourceBranchLabel.Text = '기본 브랜치'
$sourceBranchLabel.AutoSize = $true
$sourceBranchLabel.Location = New-Object System.Drawing.Point(16, 92)
$repositoryGroup.Controls.Add($sourceBranchLabel)

$sourceBranchTextBox = New-Object System.Windows.Forms.TextBox
$sourceBranchTextBox.Text = [string]$inputModel.settings.repositories.source.defaultBranch
$sourceBranchTextBox.Location = New-Object System.Drawing.Point(18, 115)
$sourceBranchTextBox.Size = New-Object System.Drawing.Size(220, 27)
$repositoryGroup.Controls.Add($sourceBranchTextBox)

$sourceRepositoryStatusLabel = New-Object System.Windows.Forms.Label
$sourceRepositoryStatusLabel.Text = '구성됨 · Client Runtime은 Source Repository의 브랜치나 소스를 직접 실행하지 않습니다.'
$sourceRepositoryStatusLabel.AutoEllipsis = $true
$sourceRepositoryStatusLabel.ForeColor = [System.Drawing.Color]::DimGray
$sourceRepositoryStatusLabel.Location = New-Object System.Drawing.Point(260, 115)
$sourceRepositoryStatusLabel.Size = New-Object System.Drawing.Size(384, 44)
$repositoryGroup.Controls.Add($sourceRepositoryStatusLabel)

$distributionRepositoryLabel = New-Object System.Windows.Forms.Label
$distributionRepositoryLabel.Text = 'Distribution Repository · 검증된 Package와 manifest 게시 위치'
$distributionRepositoryLabel.AutoSize = $true
$distributionRepositoryLabel.Location = New-Object System.Drawing.Point(16, 172)
$repositoryGroup.Controls.Add($distributionRepositoryLabel)

$distributionRepositoryTextBox = New-Object System.Windows.Forms.TextBox
$distributionRepositoryTextBox.Text = [string]$inputModel.settings.repositories.distribution.url
$distributionRepositoryTextBox.Location = New-Object System.Drawing.Point(18, 195)
$distributionRepositoryTextBox.Size = New-Object System.Drawing.Size(626, 27)
$repositoryGroup.Controls.Add($distributionRepositoryTextBox)

$distributionRepositoryStatusLabel = New-Object System.Windows.Forms.Label
$distributionRepositoryStatusLabel.Text = '구성됨 · 현재 배포 위치를 기록하며 자동 다운로드와 활성 버전 전환은 아직 TARGET입니다.'
$distributionRepositoryStatusLabel.AutoEllipsis = $true
$distributionRepositoryStatusLabel.ForeColor = [System.Drawing.Color]::DarkGoldenrod
$distributionRepositoryStatusLabel.Location = New-Object System.Drawing.Point(18, 234)
$distributionRepositoryStatusLabel.Size = New-Object System.Drawing.Size(626, 44)
$repositoryGroup.Controls.Add($distributionRepositoryStatusLabel)

$updateGroup = New-Object System.Windows.Forms.GroupBox
$updateGroup.Text = 'Update Channel'
$updateGroup.Location = New-Object System.Drawing.Point(18, 344)
$updateGroup.Size = New-Object System.Drawing.Size(674, 140)
$systemTab.Controls.Add($updateGroup)

$updateChannelLabel = New-Object System.Windows.Forms.Label
$updateChannelLabel.Text = '추적할 배포 채널'
$updateChannelLabel.AutoSize = $true
$updateChannelLabel.Location = New-Object System.Drawing.Point(16, 30)
$updateGroup.Controls.Add($updateChannelLabel)

$updateChannelComboBox = New-Object System.Windows.Forms.ComboBox
$updateChannelComboBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$updateChannelComboBox.Items.AddRange(@('stable', 'beta', 'dev'))
$updateChannelComboBox.SelectedItem = [string]$inputModel.settings.update.channel
$updateChannelComboBox.Location = New-Object System.Drawing.Point(18, 53)
$updateChannelComboBox.Size = New-Object System.Drawing.Size(220, 27)
$updateGroup.Controls.Add($updateChannelComboBox)

$updateStatusLabel = New-Object System.Windows.Forms.Label
$updateStatusLabel.Text = '설정값만 저장합니다. signed manifest 확인·버전별 설치·활성 포인터 전환·롤백은 updater 구현 뒤 사용합니다.'
$updateStatusLabel.AutoEllipsis = $true
$updateStatusLabel.ForeColor = [System.Drawing.Color]::DarkGoldenrod
$updateStatusLabel.Location = New-Object System.Drawing.Point(260, 49)
$updateStatusLabel.Size = New-Object System.Drawing.Size(384, 62)
$updateGroup.Controls.Add($updateStatusLabel)

$fontGroup = New-Object System.Windows.Forms.GroupBox
$fontGroup.Text = 'Client Runtime 자체 글꼴'
$fontGroup.Location = New-Object System.Drawing.Point(18, 18)
$fontGroup.Size = New-Object System.Drawing.Size(674, 260)
$appearanceTab.Controls.Add($fontGroup)

$uiFontLabel = New-Object System.Windows.Forms.Label
$uiFontLabel.Text = 'UI 글꼴'
$uiFontLabel.AutoSize = $true
$uiFontLabel.Location = New-Object System.Drawing.Point(16, 30)
$fontGroup.Controls.Add($uiFontLabel)

$uiFontComboBox = New-Object System.Windows.Forms.ComboBox
$uiFontComboBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$uiFontComboBox.DisplayMember = 'DisplayName'
$uiFontComboBox.Location = New-Object System.Drawing.Point(18, 53)
$uiFontComboBox.Size = New-Object System.Drawing.Size(300, 27)
foreach ($option in @($fontRuntime.Options)) {
    $null = $uiFontComboBox.Items.Add($option)
}
for ($index = 0; $index -lt $uiFontComboBox.Items.Count; $index++) {
    if ($uiFontComboBox.Items[$index].Id -eq $uiFontOption.Id) {
        $uiFontComboBox.SelectedIndex = $index
        break
    }
}
$fontGroup.Controls.Add($uiFontComboBox)

$monospaceFontLabel = New-Object System.Windows.Forms.Label
$monospaceFontLabel.Text = '고정폭 글꼴'
$monospaceFontLabel.AutoSize = $true
$monospaceFontLabel.Location = New-Object System.Drawing.Point(338, 30)
$fontGroup.Controls.Add($monospaceFontLabel)

$monospaceFontComboBox = New-Object System.Windows.Forms.ComboBox
$monospaceFontComboBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$monospaceFontComboBox.DisplayMember = 'DisplayName'
$monospaceFontComboBox.Location = New-Object System.Drawing.Point(340, 53)
$monospaceFontComboBox.Size = New-Object System.Drawing.Size(300, 27)
foreach ($option in @($fontRuntime.Options)) {
    $null = $monospaceFontComboBox.Items.Add($option)
}
for ($index = 0; $index -lt $monospaceFontComboBox.Items.Count; $index++) {
    if ($monospaceFontComboBox.Items[$index].Id -eq $monospaceFontOption.Id) {
        $monospaceFontComboBox.SelectedIndex = $index
        break
    }
}
$fontGroup.Controls.Add($monospaceFontComboBox)

$fontRootLabel = New-Object System.Windows.Forms.Label
$fontRootLabel.Text = '사용자 글꼴 폴더 (.ttf, .otf, .ttc)'
$fontRootLabel.AutoSize = $true
$fontRootLabel.Location = New-Object System.Drawing.Point(16, 98)
$fontGroup.Controls.Add($fontRootLabel)

$fontRootTextBox = New-Object System.Windows.Forms.TextBox
$fontRootTextBox.Text = [string]$appearance.fontRoot
$fontRootTextBox.Location = New-Object System.Drawing.Point(18, 121)
$fontRootTextBox.Size = New-Object System.Drawing.Size(500, 27)
$fontGroup.Controls.Add($fontRootTextBox)

$fontBrowseButton = New-Object System.Windows.Forms.Button
$fontBrowseButton.Text = '찾아보기...'
$fontBrowseButton.Location = New-Object System.Drawing.Point(528, 119)
$fontBrowseButton.Size = New-Object System.Drawing.Size(112, 31)
$fontBrowseButton.Add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Client Runtime에서 읽을 사용자 글꼴 폴더를 선택하세요.'
    $dialog.ShowNewFolderButton = $true
    if ([System.IO.Directory]::Exists($fontRootTextBox.Text)) {
        $dialog.SelectedPath = $fontRootTextBox.Text
    }
    if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
        $fontRootTextBox.Text = $dialog.SelectedPath
    }
    $dialog.Dispose()
})
$fontGroup.Controls.Add($fontBrowseButton)

$fontInfoLabel = New-Object System.Windows.Forms.Label
$fontInfoLabel.Text = '포함 글꼴은 Windows에 설치하지 않습니다. 사용자 폴더를 바꾸면 다음 접속기 실행부터 목록을 다시 읽습니다.'
$fontInfoLabel.AutoEllipsis = $true
$fontInfoLabel.ForeColor = [System.Drawing.Color]::DimGray
$fontInfoLabel.Location = New-Object System.Drawing.Point(18, 161)
$fontInfoLabel.Size = New-Object System.Drawing.Size(622, 42)
$fontGroup.Controls.Add($fontInfoLabel)

$fontWarningLabel = New-Object System.Windows.Forms.Label
$fontWarningLabel.Text = if ($fontRuntime.Warnings.Count -eq 0) {
    "포함 글꼴 3개 검증됨 · 사용자 글꼴 $($inputModel.userFontFiles.Count)개"
}
else {
    "읽지 못한 글꼴 $($fontRuntime.Warnings.Count)개 · 안전한 포함 글꼴로 대체"
}
$fontWarningLabel.AutoSize = $true
$fontWarningLabel.ForeColor = if ($fontRuntime.Warnings.Count -eq 0) { [System.Drawing.Color]::SeaGreen } else { [System.Drawing.Color]::DarkGoldenrod }
$fontWarningLabel.Location = New-Object System.Drawing.Point(18, 217)
$fontGroup.Controls.Add($fontWarningLabel)

$layoutGroup = New-Object System.Windows.Forms.GroupBox
$layoutGroup.Text = '논리 화면 기준'
$layoutGroup.Location = New-Object System.Drawing.Point(18, 294)
$layoutGroup.Size = New-Object System.Drawing.Size(674, 190)
$appearanceTab.Controls.Add($layoutGroup)

$fontSizeLabel = New-Object System.Windows.Forms.Label
$fontSizeLabel.Text = '기본 글자 크기 (pt)'
$fontSizeLabel.AutoSize = $true
$fontSizeLabel.Location = New-Object System.Drawing.Point(16, 30)
$layoutGroup.Controls.Add($fontSizeLabel)

$fontSizeNumeric = New-Object System.Windows.Forms.NumericUpDown
$fontSizeNumeric.DecimalPlaces = 1
$fontSizeNumeric.Increment = [decimal]0.5
$fontSizeNumeric.Minimum = [decimal]8
$fontSizeNumeric.Maximum = [decimal]24
$fontSizeNumeric.Value = [decimal]$appearance.baseFontSizePt
$fontSizeNumeric.Location = New-Object System.Drawing.Point(18, 53)
$fontSizeNumeric.Size = New-Object System.Drawing.Size(130, 27)
$layoutGroup.Controls.Add($fontSizeNumeric)

$uiScaleLabel = New-Object System.Windows.Forms.Label
$uiScaleLabel.Text = '사용자 UI 배율 (%)'
$uiScaleLabel.AutoSize = $true
$uiScaleLabel.Location = New-Object System.Drawing.Point(178, 30)
$layoutGroup.Controls.Add($uiScaleLabel)

$uiScaleComboBox = New-Object System.Windows.Forms.ComboBox
$uiScaleComboBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
$uiScaleComboBox.Items.AddRange(@(80, 90, 100, 110, 125, 150))
$uiScaleComboBox.SelectedItem = [int]$appearance.uiScalePercent
$uiScaleComboBox.Location = New-Object System.Drawing.Point(180, 53)
$uiScaleComboBox.Size = New-Object System.Drawing.Size(130, 27)
$layoutGroup.Controls.Add($uiScaleComboBox)

$widthLabel = New-Object System.Windows.Forms.Label
$widthLabel.Text = '창 너비 (DIP)'
$widthLabel.AutoSize = $true
$widthLabel.Location = New-Object System.Drawing.Point(340, 30)
$layoutGroup.Controls.Add($widthLabel)

$widthNumeric = New-Object System.Windows.Forms.NumericUpDown
$widthNumeric.Minimum = [decimal]640
$widthNumeric.Maximum = [decimal]2560
$widthNumeric.Increment = [decimal]20
$widthNumeric.Value = [decimal]$appearance.windowWidthDip
$widthNumeric.Location = New-Object System.Drawing.Point(342, 53)
$widthNumeric.Size = New-Object System.Drawing.Size(130, 27)
$layoutGroup.Controls.Add($widthNumeric)

$heightLabel = New-Object System.Windows.Forms.Label
$heightLabel.Text = '창 높이 (DIP)'
$heightLabel.AutoSize = $true
$heightLabel.Location = New-Object System.Drawing.Point(502, 30)
$layoutGroup.Controls.Add($heightLabel)

$heightNumeric = New-Object System.Windows.Forms.NumericUpDown
$heightNumeric.Minimum = [decimal]560
$heightNumeric.Maximum = [decimal]1600
$heightNumeric.Increment = [decimal]20
$heightNumeric.Value = [decimal]$appearance.windowHeightDip
$heightNumeric.Location = New-Object System.Drawing.Point(504, 53)
$heightNumeric.Size = New-Object System.Drawing.Size(130, 27)
$layoutGroup.Controls.Add($heightNumeric)

$dpiInfoLabel = New-Object System.Windows.Forms.Label
$dpiInfoLabel.Text = '저장값은 96 DPI 기준 DIP입니다. Windows 실제 DPI와 사용자 배율을 함께 적용하며, 화면보다 크면 스크롤 가능한 크기로 제한합니다.'
$dpiInfoLabel.AutoEllipsis = $true
$dpiInfoLabel.ForeColor = [System.Drawing.Color]::DimGray
$dpiInfoLabel.Location = New-Object System.Drawing.Point(18, 104)
$dpiInfoLabel.Size = New-Object System.Drawing.Size(616, 44)
$layoutGroup.Controls.Add($dpiInfoLabel)

$applyInfoLabel = New-Object System.Windows.Forms.Label
$applyInfoLabel.Text = '변경한 화면 옵션은 저장 후 다음 Client Runtime 접속기부터 적용됩니다.'
$applyInfoLabel.AutoSize = $true
$applyInfoLabel.ForeColor = [System.Drawing.Color]::DarkGoldenrod
$applyInfoLabel.Location = New-Object System.Drawing.Point(18, 156)
$layoutGroup.Controls.Add($applyInfoLabel)

$detailsGroup = New-Object System.Windows.Forms.GroupBox
$detailsGroup.Text = '실행 정보'
$detailsGroup.Location = New-Object System.Drawing.Point(18, 18)
$detailsGroup.Size = New-Object System.Drawing.Size(674, 120)
$infoTab.Controls.Add($detailsGroup)

$detailsLabel = New-Object System.Windows.Forms.Label
$detailsLabel.Text = "클라이언트 설치 위치`r`n$($inputModel.appRoot)`r`n설정 파일`r`n$($inputModel.settingsPath)`r`n비공개 UI 글꼴: $($uiFontOption.DisplayName)"
$detailsLabel.AutoEllipsis = $true
$detailsLabel.Location = New-Object System.Drawing.Point(12, 24)
$detailsLabel.Size = New-Object System.Drawing.Size(640, 92)
$detailsLabel.ForeColor = [System.Drawing.Color]::DimGray
$detailsGroup.Controls.Add($detailsLabel)

$openFolderButton = New-Object System.Windows.Forms.Button
$openFolderButton.Text = '데이터 폴더 열기'
$openFolderButton.Location = New-Object System.Drawing.Point(20, 650)
$openFolderButton.Size = New-Object System.Drawing.Size(140, 36)
$openFolderButton.Add_Click({
    try {
        [System.IO.Directory]::CreateDirectory($dataTextBox.Text) | Out-Null
        Start-Process -FilePath 'explorer.exe' -ArgumentList ('"{0}"' -f $dataTextBox.Text)
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show($form, $_.Exception.Message, '폴더를 열 수 없습니다.', 'OK', 'Error') | Out-Null
    }
})
$form.Controls.Add($openFolderButton)

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = if ($lifecycleReason -eq 'startup') { '취소' } else { '클라이언트 종료' }
$cancelButton.Location = New-Object System.Drawing.Point(538, 650)
$cancelButton.Size = New-Object System.Drawing.Size(90, 36)
$cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.CancelButton = $cancelButton
$form.Controls.Add($cancelButton)

$startButton = New-Object System.Windows.Forms.Button
$startButton.Text = '인스턴스 시작'
$startButton.Location = New-Object System.Drawing.Point(638, 650)
$startButton.Size = New-Object System.Drawing.Size(96, 36)
$startButton.Add_Click({
    try {
        $selectedPath = $dataTextBox.Text.Trim()
        if (-not [System.IO.Path]::IsPathRooted($selectedPath)) {
            throw '데이터 폴더는 드라이브 문자를 포함한 절대 경로여야 합니다.'
        }
        $fullPath = [System.IO.Path]::GetFullPath($selectedPath).TrimEnd('\')
        $pathRoot = [System.IO.Path]::GetPathRoot($fullPath).TrimEnd('\')
        if ($fullPath.Equals($pathRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw '드라이브 루트는 데이터 폴더로 사용할 수 없습니다.'
        }
        $appRoot = [System.IO.Path]::GetFullPath([string]$inputModel.appRoot).TrimEnd('\')
        if (-not $isPortable -and (
            $fullPath.Equals($appRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
            $fullPath.StartsWith("$appRoot\", [System.StringComparison]::OrdinalIgnoreCase)
        )) {
            throw '설치 폴더 내부는 데이터 폴더로 사용할 수 없습니다.'
        }
        [System.IO.Directory]::CreateDirectory($fullPath) | Out-Null
        $probePath = [System.IO.Path]::Combine($fullPath, ".gongpil-write-probe-$([System.Guid]::NewGuid())")
        [System.IO.File]::WriteAllText($probePath, 'gongpil')
        Remove-Item -LiteralPath $probePath -Force
        $dataTextBox.Text = $fullPath
        $selectedFontRoot = $fontRootTextBox.Text.Trim()
        if (-not [System.IO.Path]::IsPathRooted($selectedFontRoot)) {
            throw '사용자 글꼴 폴더는 드라이브 문자를 포함한 절대 경로여야 합니다.'
        }
        $fullFontRoot = [System.IO.Path]::GetFullPath($selectedFontRoot).TrimEnd('\')
        $fontPathRoot = [System.IO.Path]::GetPathRoot($fullFontRoot).TrimEnd('\')
        if ($fullFontRoot.Equals($fontPathRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw '드라이브 루트는 사용자 글꼴 폴더로 사용할 수 없습니다.'
        }
        if (-not $isPortable -and (
            $fullFontRoot.Equals($appRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
            $fullFontRoot.StartsWith("$appRoot\", [System.StringComparison]::OrdinalIgnoreCase)
        )) {
            throw '설치 폴더 내부는 사용자 글꼴 폴더로 사용할 수 없습니다.'
        }
        [System.IO.Directory]::CreateDirectory($fullFontRoot) | Out-Null
        $fontProbePath = [System.IO.Path]::Combine($fullFontRoot, ".gongpil-font-probe-$([System.Guid]::NewGuid())")
        [System.IO.File]::WriteAllText($fontProbePath, 'gongpil')
        Remove-Item -LiteralPath $fontProbePath -Force
        $fontRootTextBox.Text = $fullFontRoot
        if ($null -eq $uiFontComboBox.SelectedItem -or $null -eq $monospaceFontComboBox.SelectedItem) {
            throw 'UI 글꼴과 고정폭 글꼴을 선택해야 합니다.'
        }
        $apiPath = $apiTextBox.Text.Trim()
        if (-not [string]::IsNullOrWhiteSpace($apiPath)) {
            if (-not [System.IO.Path]::IsPathRooted($apiPath) -or -not [System.IO.File]::Exists($apiPath)) {
                throw 'OpenAI API 환경파일을 찾을 수 없습니다.'
            }
            $apiTextBox.Text = [System.IO.Path]::GetFullPath($apiPath)
        }
        $codexPath = $codexTextBox.Text.Trim()
        if (-not [string]::IsNullOrWhiteSpace($codexPath)) {
            if (-not [System.IO.Path]::IsPathRooted($codexPath) -or -not [System.IO.File]::Exists($codexPath)) {
                throw 'Codex 실행 파일을 찾을 수 없습니다.'
            }
            $codexTextBox.Text = [System.IO.Path]::GetFullPath($codexPath)
        }
        if ($codexModelComboBox.Text -notmatch '^gpt-[A-Za-z0-9._-]+$') {
            throw 'Codex 모델 이름이 올바르지 않습니다.'
        }
        if ($modelComboBox.Text -notmatch '^gpt-[A-Za-z0-9._-]+$') {
            throw 'OpenAI 모델 이름이 올바르지 않습니다.'
        }
        $sourceRepositoryTextBox.Text = Resolve-HttpsConfigUrl -Value $sourceRepositoryTextBox.Text -Label 'Source Repository'
        $sourceBranchTextBox.Text = Resolve-GitBranch -Value $sourceBranchTextBox.Text
        $distributionRepositoryTextBox.Text = Resolve-HttpsConfigUrl -Value $distributionRepositoryTextBox.Text -Label 'Distribution Repository'
        if ($null -eq $updateChannelComboBox.SelectedItem) {
            throw 'Update Channel을 선택해야 합니다.'
        }
        $script:resultAction = 'start'
        $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
        $form.Close()
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show($form, $_.Exception.Message, '공필 설정을 저장할 수 없습니다.', 'OK', 'Warning') | Out-Null
    }
})
$form.AcceptButton = $startButton
$form.Controls.Add($startButton)

if ($inputModel.isFirstRun) {
    $tabControl.SelectedTab = $settingsTab
}

if ([Math]::Abs($uiScale - 1.0) -gt 0.001) {
    $form.Scale((New-Object System.Drawing.SizeF($uiScale, $uiScale)))
}
$form.ClientSize = New-Object System.Drawing.Size(
    [int][Math]::Round([single]$appearance.windowWidthDip * $uiScale),
    [int][Math]::Round([single]$appearance.windowHeightDip * $uiScale)
)
$scaledBaseFont = New-ClientFont -Family $uiFontFamily -Size ([single]($baseFontSizePt * $uiScale)) -Style ([System.Drawing.FontStyle]::Regular)
$scaledTitleFont = New-ClientFont -Family $uiFontFamily -Size ([single](14 * $uiScale)) -Style ([System.Drawing.FontStyle]::Bold)
$scaledRuntimeFont = New-ClientFont -Family $uiFontFamily -Size ([single](12 * $uiScale)) -Style ([System.Drawing.FontStyle]::Bold)
$scaledSectionFont = New-ClientFont -Family $uiFontFamily -Size ([single](10 * $uiScale)) -Style ([System.Drawing.FontStyle]::Bold)
$ownedFonts += $scaledBaseFont
$ownedFonts += $scaledTitleFont
$ownedFonts += $scaledRuntimeFont
$ownedFonts += $scaledSectionFont
$form.Font = $scaledBaseFont
$titleLabel.Font = $scaledTitleFont
$runtimeStatusLabel.Font = $scaledRuntimeFont
$capabilityLabel.Font = $scaledSectionFont
$changesLabel.Font = $scaledSectionFont
$form.Add_Shown({
    $workingArea = [System.Windows.Forms.Screen]::FromControl($form).WorkingArea
    $nonClientWidth = $form.Width - $form.ClientSize.Width
    $nonClientHeight = $form.Height - $form.ClientSize.Height
    $maximumClientWidth = [Math]::Max(480, $workingArea.Width - $nonClientWidth - 40)
    $maximumClientHeight = [Math]::Max(420, $workingArea.Height - $nonClientHeight - 40)
    if ($form.ClientSize.Width -gt $maximumClientWidth -or $form.ClientSize.Height -gt $maximumClientHeight) {
        $form.ClientSize = New-Object System.Drawing.Size(
            [Math]::Min($form.ClientSize.Width, $maximumClientWidth),
            [Math]::Min($form.ClientSize.Height, $maximumClientHeight)
        )
    }
    $centerX = $workingArea.Left + [Math]::Max(0, [Math]::Floor(($workingArea.Width - $form.Width) / 2))
    $centerY = $workingArea.Top + [Math]::Max(0, [Math]::Floor(($workingArea.Height - $form.Height) / 2))
    $form.Location = New-Object System.Drawing.Point($centerX, $centerY)
})

if ([string]::IsNullOrWhiteSpace($AutomationAction)) {
    $null = $form.ShowDialog()
}
elseif ($AutomationAction -eq 'ProbeShown') {
    $form.Opacity = 0
    $form.ShowInTaskbar = $false
    $form.Show()
    [System.Windows.Forms.Application]::DoEvents()
    $form.Close()
}
else {
    $resultAction = $AutomationAction.ToLowerInvariant()
}
$outputModel = [ordered]@{
    action = $resultAction
    dataRoot = $dataTextBox.Text
    showConnectorOnStartup = $startupCheckBox.Checked
    aiProvider = if ($providerComboBox.SelectedIndex -eq 1) { 'openai-api' } else { 'codex' }
    codexExecutable = $codexTextBox.Text
    codexModel = $codexModelComboBox.Text
    openAiEnvFile = $apiTextBox.Text
    openAiModel = $modelComboBox.Text
    repositories = [ordered]@{
        source = [ordered]@{
            type = 'git'
            url = $sourceRepositoryTextBox.Text
            defaultBranch = $sourceBranchTextBox.Text
        }
        distribution = [ordered]@{
            type = 'github-releases'
            url = $distributionRepositoryTextBox.Text
        }
    }
    update = [ordered]@{
        channel = [string]$updateChannelComboBox.SelectedItem
    }
    appearance = [ordered]@{
        baselineDpi = 96
        fontRoot = $fontRootTextBox.Text
        uiFontId = [string]$uiFontComboBox.SelectedItem.Id
        monospaceFontId = [string]$monospaceFontComboBox.SelectedItem.Id
        baseFontSizePt = [double]$fontSizeNumeric.Value
        uiScalePercent = [int]$uiScaleComboBox.SelectedItem
        windowWidthDip = [int]$widthNumeric.Value
        windowHeightDip = [int]$heightNumeric.Value
    }
}
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutputPath, ($outputModel | ConvertTo-Json), $utf8WithoutBom)
$form.Dispose()
foreach ($font in $ownedFonts) {
    $font.Dispose()
}
$fontRuntime.Collection.Dispose()
