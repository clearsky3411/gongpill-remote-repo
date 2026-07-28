[CmdletBinding()]
param(
    [string]$Version = '0.1.0',
    [string]$OutputRoot,
    [switch]$SkipArchive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$nodeVersion = '24.18.0'
$nodeArchiveName = "node-v$nodeVersion-win-x64.zip"
$nodeArchiveSha256 = '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$distributionRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'distribution'))

function Test-PathInside {
    param(
        [string]$ParentPath,
        [string]$ChildPath,
        [switch]$AllowEqual
    )

    $parent = [System.IO.Path]::GetFullPath($ParentPath).TrimEnd('\')
    $child = [System.IO.Path]::GetFullPath($ChildPath).TrimEnd('\')
    if ($AllowEqual -and $child.Equals($parent, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }
    return $child.StartsWith("$parent\", [System.StringComparison]::OrdinalIgnoreCase)
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

function Receive-OfficialNodeRuntime {
    param(
        [string]$ArchivePath,
        [string]$ChecksumPath
    )

    $releaseRoot = "https://nodejs.org/dist/v$nodeVersion"
    Invoke-WebRequest -UseBasicParsing -Uri "$releaseRoot/SHASUMS256.txt" -OutFile $ChecksumPath
    $officialLine = Get-Content -LiteralPath $ChecksumPath |
        Where-Object { $_ -match "\s+$([regex]::Escape($nodeArchiveName))$" } |
        Select-Object -First 1
    if ($null -eq $officialLine) {
        throw "공식 SHASUMS256에서 $nodeArchiveName 항목을 찾지 못했습니다."
    }
    $officialHash = ($officialLine -split '\s+')[0].ToLowerInvariant()
    if ($officialHash -ne $nodeArchiveSha256) {
        throw "고정한 Node checksum과 공식 SHASUMS256이 다릅니다: $officialHash"
    }

    if (-not (Test-Path -LiteralPath $ArchivePath)) {
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseRoot/$nodeArchiveName" -OutFile $ArchivePath
    }
    $actualHash = Get-Sha256 -Path $ArchivePath
    if ($actualHash -ne $nodeArchiveSha256) {
        Remove-Item -LiteralPath $ArchivePath -Force
        throw "다운로드한 Node archive checksum이 올바르지 않습니다: $actualHash"
    }
}

function Copy-ProjectTree {
    param([string]$RelativePath)

    $sourcePath = Join-Path $projectRoot $RelativePath
    $destinationPath = Join-Path $packageRoot $RelativePath
    New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($destinationPath)) | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Recurse
}

if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') {
    throw "배포 버전 형식이 올바르지 않습니다: $Version"
}

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = $distributionRoot
}
elseif (-not [System.IO.Path]::IsPathRooted($OutputRoot)) {
    $OutputRoot = Join-Path $projectRoot $OutputRoot
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)

if (-not (Test-PathInside -ParentPath $distributionRoot -ChildPath $OutputRoot -AllowEqual)) {
    throw "배포 산출물은 distribution 안에만 만들 수 있습니다: $OutputRoot"
}

$packageName = "Gongpil-$Version-portable"
$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $OutputRoot $packageName))
if (-not (Test-PathInside -ParentPath $OutputRoot -ChildPath $packageRoot)) {
    throw "안전하지 않은 패키지 경로입니다: $packageRoot"
}

$cacheRoot = Join-Path ([System.IO.Path]::GetTempPath()) "gongpil-build-cache\node-v$nodeVersion"
$archivePath = Join-Path $cacheRoot $nodeArchiveName
$checksumPath = Join-Path $cacheRoot 'SHASUMS256.txt'
$expandedRoot = Join-Path $cacheRoot 'expanded'
$nodeReleaseRoot = Join-Path $expandedRoot "node-v$nodeVersion-win-x64"

New-Item -ItemType Directory -Force -Path $OutputRoot, $cacheRoot | Out-Null
Receive-OfficialNodeRuntime -ArchivePath $archivePath -ChecksumPath $checksumPath

if (Test-Path -LiteralPath $expandedRoot) {
    Remove-Item -LiteralPath $expandedRoot -Recurse -Force
}
Expand-Archive -LiteralPath $archivePath -DestinationPath $expandedRoot
if (-not (Test-Path -LiteralPath (Join-Path $nodeReleaseRoot 'node.exe'))) {
    throw '공식 Node archive에서 node.exe를 찾지 못했습니다.'
}

if (Test-Path -LiteralPath $packageRoot) {
    Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $packageRoot | Out-Null

Copy-ProjectTree -RelativePath 'browser\src'
Copy-ProjectTree -RelativePath 'client\src'
Copy-ProjectTree -RelativePath 'client\windows'
Copy-ProjectTree -RelativePath 'core\src'
Copy-ProjectTree -RelativePath 'packages\contracts'
Copy-ProjectTree -RelativePath 'platform\network-runtime\browser'
Copy-ProjectTree -RelativePath 'platform\network-runtime\src'
Copy-Item -LiteralPath (Join-Path $projectRoot 'package.json') -Destination $packageRoot

$runtimeRoot = Join-Path $packageRoot 'runtime'
New-Item -ItemType Directory -Path $runtimeRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $nodeReleaseRoot 'node.exe') -Destination $runtimeRoot
Copy-Item -LiteralPath (Join-Path $nodeReleaseRoot 'LICENSE') -Destination (Join-Path $runtimeRoot 'NODE_LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $projectRoot 'installer\launcher\Gongpil.cmd') -Destination $packageRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'installer\launcher\Gongpil.vbs') -Destination $packageRoot
New-Item -ItemType File -Path (Join-Path $packageRoot 'portable.marker') | Out-Null

$runtimeVersion = (& (Join-Path $runtimeRoot 'node.exe') --version).Trim()
if ($LASTEXITCODE -ne 0 -or $runtimeVersion -ne "v$nodeVersion") {
    throw "포함 Node runtime 버전 검증 실패: $runtimeVersion"
}

$manifest = [ordered]@{
    schemaVersion = 1
    product = 'Gongpil'
    productVersion = $Version
    mode = 'portable'
    nodeVersion = $nodeVersion
    nodeArchive = $nodeArchiveName
    nodeArchiveSha256 = $nodeArchiveSha256
    entrypoint = 'Gongpil.vbs'
    diagnosticEntrypoint = 'Gongpil.cmd'
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $packageRoot 'build-manifest.json') -Encoding utf8

$zipPath = Join-Path $OutputRoot "$packageName.zip"
$zipChecksumPath = "$zipPath.sha256"
if (-not $SkipArchive) {
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
    $zipHash = Get-Sha256 -Path $zipPath
    "$zipHash  $([System.IO.Path]::GetFileName($zipPath))" | Set-Content -LiteralPath $zipChecksumPath -Encoding ascii
}

[ordered]@{
    packageRoot = $packageRoot
    archivePath = if ($SkipArchive) { $null } else { $zipPath }
    runtimeVersion = $runtimeVersion
    runtimeArchiveSha256 = $nodeArchiveSha256
} | ConvertTo-Json
