[CmdletBinding()]
param(
    [string]$SchemaPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($SchemaPath)) {
    $SchemaPath = Join-Path $projectRoot 'packages\contracts\bootstrap\bootstrap-contracts.schema.json'
}

$resolvedSchemaPath = (Resolve-Path -LiteralPath $SchemaPath).Path
$schema = Get-Content -LiteralPath $resolvedSchemaPath -Raw | ConvertFrom-Json
$errors = [System.Collections.Generic.List[string]]::new()
$definitions = $schema.'$defs'

$requiredDefinitions = @(
    'ProtocolVersion',
    'SupportedProtocolRange',
    'BootstrapPaths',
    'ClientBootstrapConfig',
    'CoreReadyInfo',
    'CoreActivationResult',
    'BrowserSessionSummary',
    'BootstrapError'
)

foreach ($definitionName in $requiredDefinitions) {
    if ($definitions.PSObject.Properties.Name -notcontains $definitionName) {
        $errors.Add("필수 계약 정의 없음: $definitionName")
    }
}

$topLevelMessages = @(
    'ClientBootstrapConfig',
    'CoreReadyInfo',
    'CoreActivationResult',
    'BrowserSessionSummary',
    'BootstrapError'
)

foreach ($messageName in $topLevelMessages) {
    if ($definitions.PSObject.Properties.Name -notcontains $messageName) {
        continue
    }

    $messageSchema = $definitions.$messageName
    if ($messageSchema.additionalProperties -ne $false) {
        $errors.Add("additionalProperties가 false가 아님: $messageName")
    }
}

$versionedMessages = @(
    'ClientBootstrapConfig',
    'CoreReadyInfo',
    'CoreActivationResult',
    'BrowserSessionSummary'
)

foreach ($messageName in $versionedMessages) {
    if ($definitions.PSObject.Properties.Name -notcontains $messageName) {
        continue
    }

    $requiredFields = @($definitions.$messageName.required)
    if ($requiredFields -notcontains 'protocolVersion') {
        $errors.Add("protocolVersion 필수 지정 없음: $messageName")
    }
}

$requiredBootstrapPaths = @('appRoot', 'dataRoot', 'versionRoot', 'sessionTemp', 'bundledRuntimePath')
if ($definitions.PSObject.Properties.Name -contains 'BootstrapPaths') {
    $actualBootstrapPaths = @($definitions.BootstrapPaths.required)
    foreach ($requiredPath in $requiredBootstrapPaths) {
        if ($actualBootstrapPaths -notcontains $requiredPath) {
            $errors.Add("Client-Core 내부 경로 필드 없음: $requiredPath")
        }
    }
}

$requiredCoreReadyFields = @('coreVersion', 'coreApiVersion', 'health', 'networkProfile')
if ($definitions.PSObject.Properties.Name -contains 'CoreReadyInfo') {
    $actualCoreReadyFields = @($definitions.CoreReadyInfo.required)
    foreach ($requiredField in $requiredCoreReadyFields) {
        if ($actualCoreReadyFields -notcontains $requiredField) {
            $errors.Add("CoreReadyInfo 필수 필드 없음: $requiredField")
        }
    }
}

$forbiddenBrowserFieldPattern = '(?i)(path|root|directory|endpoint|origin|host|port|token|secret|credential|executable|runtime|connectionhandle|networkprofile|connectionprofile)'
if ($definitions.PSObject.Properties.Name -contains 'BrowserSessionSummary') {
    $browserPropertyNames = @($definitions.BrowserSessionSummary.properties.PSObject.Properties.Name)
    foreach ($propertyName in $browserPropertyNames) {
        if ($propertyName -match $forbiddenBrowserFieldPattern) {
            $errors.Add("Browser 계약 금지 필드: $propertyName")
        }
    }
}

if ($definitions.PSObject.Properties.Name -contains 'BootstrapError') {
    $errorPropertyNames = @($definitions.BootstrapError.properties.PSObject.Properties.Name)
    foreach ($propertyName in $errorPropertyNames) {
        if ($propertyName -match $forbiddenBrowserFieldPattern) {
            $errors.Add("공개 BootstrapError 금지 필드: $propertyName")
        }
    }
}

if ($errors.Count -gt 0) {
    Write-Host 'Bootstrap Contract 검증 실패' -ForegroundColor Red
    foreach ($validationError in $errors) {
        Write-Host "- $validationError" -ForegroundColor Red
    }
    exit 1
}

Write-Host 'Bootstrap Contract 검증 성공' -ForegroundColor Green
Write-Host "계약 정의: $($requiredDefinitions -join ', ')"
Write-Host 'Browser 경계: 절대 경로, endpoint, token, secret, credential, runtime, network profile 필드 없음'
