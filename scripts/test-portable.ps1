[CmdletBinding()]
param([string]$Version = '0.1.0')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$buildOutput = & (Join-Path $PSScriptRoot 'build-portable.ps1') -Version $Version | ConvertFrom-Json
$nodeCommand = Get-Command node -ErrorAction Stop
$previousPackageRoot = $env:GONGPIL_PORTABLE_ROOT
$extractRoot = Join-Path ([System.IO.Path]::GetTempPath()) "gongpil-portable-test-$([System.Guid]::NewGuid())"

try {
    New-Item -ItemType Directory -Path $extractRoot | Out-Null
    Expand-Archive -LiteralPath $buildOutput.archivePath -DestinationPath $extractRoot
    $env:GONGPIL_PORTABLE_ROOT = Join-Path $extractRoot ([System.IO.Path]::GetFileName($buildOutput.packageRoot))
    & $nodeCommand.Source --test (Join-Path $projectRoot 'tests\distribution\portable-package.test.ts')
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    $env:GONGPIL_PORTABLE_ROOT = $previousPackageRoot
    if (Test-Path -LiteralPath $extractRoot) {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force
    }
}
