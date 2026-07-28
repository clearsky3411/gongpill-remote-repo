[CmdletBinding()]
param([string]$Version = '0.1.0')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$distributionRoot = Join-Path $projectRoot 'distribution'

function Invoke-NpmScript {
    param([string]$Name)

    Write-Host "`n[release] npm run $Name" -ForegroundColor Cyan
    & $npmCommand run $Name
    if ($LASTEXITCODE -ne 0) {
        throw "릴리스 검증 실패: npm run $Name (exit=$LASTEXITCODE)"
    }
}

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

function Test-ArtifactChecksum {
    param([string]$ArtifactPath)

    $checksumPath = "$ArtifactPath.sha256"
    if (-not (Test-Path -LiteralPath $ArtifactPath) -or -not (Test-Path -LiteralPath $checksumPath)) {
        throw "릴리스 산출물 또는 checksum이 없습니다: $ArtifactPath"
    }
    $checksumLine = (Get-Content -LiteralPath $checksumPath -Raw).Trim()
    $expectedLine = "$(Get-Sha256 -Path $ArtifactPath)  $([System.IO.Path]::GetFileName($ArtifactPath))"
    if ($checksumLine -ne $expectedLine) {
        throw "릴리스 checksum 불일치: $([System.IO.Path]::GetFileName($ArtifactPath))"
    }
    return [ordered]@{
        path = $ArtifactPath
        bytes = (Get-Item -LiteralPath $ArtifactPath).Length
        sha256 = ($expectedLine -split '\s+')[0]
    }
}

$env:GIT_CONFIG_COUNT = '1'
$env:GIT_CONFIG_KEY_0 = 'safe.directory'
$env:GIT_CONFIG_VALUE_0 = $projectRoot.Replace('\', '/')

Invoke-NpmScript -Name 'test:network'
Invoke-NpmScript -Name 'test:bootstrap'
Invoke-NpmScript -Name 'test:client'
Invoke-NpmScript -Name 'test:mvp'
Invoke-NpmScript -Name 'test:portable'
Invoke-NpmScript -Name 'test:installer'
Invoke-NpmScript -Name 'validate:architecture'

$portableArtifact = Test-ArtifactChecksum -ArtifactPath (Join-Path $distributionRoot "Gongpil-$Version-portable.zip")
$installerArtifact = Test-ArtifactChecksum -ArtifactPath (Join-Path $distributionRoot "Gongpil-$Version-setup.exe")

Write-Host "`n[release] Gongpil $Version MVP 전체 검증 성공" -ForegroundColor Green
[ordered]@{
    version = $Version
    validatedAt = (Get-Date).ToUniversalTime().ToString('o')
    checks = @('test:network', 'test:bootstrap', 'test:client', 'test:mvp', 'test:portable', 'test:installer', 'validate:architecture')
    artifacts = @($portableArtifact, $installerArtifact)
} | ConvertTo-Json -Depth 4
