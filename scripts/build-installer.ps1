[CmdletBinding()]
param(
    [string]$Version = '0.1.0',
    [string]$OutputRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$distributionRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'distribution'))

function Get-Sha256 {
    param([string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $algorithm = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
        }
        finally {
            $algorithm.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Find-InnoCompiler {
    $candidates = @(
        $env:INNO_SETUP_ISCC,
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    throw 'Inno Setup 6 ISCC.exe가 없습니다. winget install --id JRSoftware.InnoSetup -e 명령으로 설치하세요.'
}

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Installer 버전은 major.minor.patch 형식이어야 합니다: $Version"
}
if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = $distributionRoot
}
elseif (-not [System.IO.Path]::IsPathRooted($OutputRoot)) {
    $OutputRoot = Join-Path $projectRoot $OutputRoot
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
if (-not $OutputRoot.Equals($distributionRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Installer 산출물은 distribution 루트에만 만들 수 있습니다: $OutputRoot"
}

$portableBuild = & (Join-Path $PSScriptRoot 'build-portable.ps1') -Version $Version -OutputRoot $OutputRoot -SkipArchive |
    ConvertFrom-Json
$isccPath = Find-InnoCompiler
$setupScript = Join-Path $projectRoot 'installer\windows\Gongpil.iss'
$setupBaseName = "Gongpil-$Version-setup"
$setupPath = Join-Path $OutputRoot "$setupBaseName.exe"
if (Test-Path -LiteralPath $setupPath) {
    Remove-Item -LiteralPath $setupPath -Force
}

$numericVersion = "$Version.0"
$compilerOutput = @(& $isccPath /Q "/DAppVersion=$Version" "/DAppNumericVersion=$numericVersion" "/DAppSourceRoot=$($portableBuild.packageRoot)" "/O$OutputRoot" "/F$setupBaseName" $setupScript 2>&1)
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $setupPath)) {
    throw "Inno Setup 컴파일 실패: exit=$LASTEXITCODE`n$($compilerOutput -join [Environment]::NewLine)"
}

$setupHash = Get-Sha256 -Path $setupPath
$checksumPath = "$setupPath.sha256"
"$setupHash  $([System.IO.Path]::GetFileName($setupPath))" | Set-Content -LiteralPath $checksumPath -Encoding ascii

[ordered]@{
    setupPath = $setupPath
    checksumPath = $checksumPath
    setupSha256 = $setupHash
    compilerPath = $isccPath
    portableSourceRoot = $portableBuild.packageRoot
} | ConvertTo-Json
