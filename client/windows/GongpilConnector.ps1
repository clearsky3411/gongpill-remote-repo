[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [ValidateSet('Start', 'Cancel')][string]$AutomationAction
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$inputModel = Get-Content -LiteralPath $InputPath -Raw | ConvertFrom-Json
$isPortable = $inputModel.mode -eq 'portable'
$lifecycleReason = if ($null -eq $inputModel.PSObject.Properties['lifecycleReason']) { 'startup' } else { [string]$inputModel.lifecycleReason }
$releaseNotes = if ($null -eq $inputModel.PSObject.Properties['releaseNotes']) {
    [pscustomobject]@{
        productVersion = '0.1.0'
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

$form = New-Object System.Windows.Forms.Form
$form.Text = "공필 클라이언트 $($releaseNotes.productVersion)"
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ClientSize = New-Object System.Drawing.Size(760, 720)
$form.Font = New-Object System.Drawing.Font('Malgun Gothic', 9)

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
$titleLabel.Font = New-Object System.Drawing.Font('Malgun Gothic', 14, [System.Drawing.FontStyle]::Bold)
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
$runtimeStatusLabel.Font = New-Object System.Drawing.Font('Malgun Gothic', 12, [System.Drawing.FontStyle]::Bold)
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
$capabilityLabel.Font = New-Object System.Drawing.Font('Malgun Gothic', 10, [System.Drawing.FontStyle]::Bold)
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
$changesLabel.Font = New-Object System.Drawing.Font('Malgun Gothic', 10, [System.Drawing.FontStyle]::Bold)
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

$detailsGroup = New-Object System.Windows.Forms.GroupBox
$detailsGroup.Text = '실행 정보'
$detailsGroup.Location = New-Object System.Drawing.Point(18, 18)
$detailsGroup.Size = New-Object System.Drawing.Size(674, 120)
$infoTab.Controls.Add($detailsGroup)

$detailsLabel = New-Object System.Windows.Forms.Label
$detailsLabel.Text = "클라이언트 설치 위치`r`n$($inputModel.appRoot)`r`n설정 파일`r`n$($inputModel.settingsPath)"
$detailsLabel.AutoEllipsis = $true
$detailsLabel.Location = New-Object System.Drawing.Point(12, 24)
$detailsLabel.Size = New-Object System.Drawing.Size(640, 88)
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
        $script:resultAction = 'start'
        $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
        $form.Close()
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show($form, $_.Exception.Message, '데이터 폴더를 사용할 수 없습니다.', 'OK', 'Warning') | Out-Null
    }
})
$form.AcceptButton = $startButton
$form.Controls.Add($startButton)

if ($inputModel.isFirstRun) {
    $tabControl.SelectedTab = $settingsTab
}

if ([string]::IsNullOrWhiteSpace($AutomationAction)) {
    $null = $form.ShowDialog()
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
}
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($OutputPath, ($outputModel | ConvertTo-Json), $utf8WithoutBom)
$form.Dispose()
