[CmdletBinding()]
param([string]$Version = '0.1.1')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$buildOutput = & (Join-Path $PSScriptRoot 'build-installer.ps1') -Version $Version | ConvertFrom-Json
$nodeCommand = Get-Command node -ErrorAction Stop
$previousSetupPath = $env:GONGPIL_SETUP_PATH

try {
    $env:GONGPIL_SETUP_PATH = $buildOutput.setupPath
    & $nodeCommand.Source --test (Join-Path $projectRoot 'tests\distribution\windows-installer.test.ts')
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    $env:GONGPIL_SETUP_PATH = $previousSetupPath
}
