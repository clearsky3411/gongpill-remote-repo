[CmdletBinding()]
param(
    [string]$SchemaPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($SchemaPath)) {
    $SchemaPath = Join-Path $projectRoot 'packages\contracts\network\network-contracts.schema.json'
}

$resolvedSchemaPath = (Resolve-Path -LiteralPath $SchemaPath).Path
$schema = Get-Content -LiteralPath $resolvedSchemaPath -Raw | ConvertFrom-Json
$errors = [System.Collections.Generic.List[string]]::new()
$definitions = $schema.'$defs'

$requiredDefinitions = @(
    'ProtocolVersion',
    'NetworkConnectionProfile',
    'NetworkCommandRequest',
    'NetworkCommandResult',
    'NetworkEvent',
    'NetworkStatus',
    'NetworkError'
)

foreach ($definitionName in $requiredDefinitions) {
    if ($definitions.PSObject.Properties.Name -notcontains $definitionName) {
        $errors.Add("필수 네트워크 계약 정의 없음: $definitionName")
    }
}

foreach ($messageName in $requiredDefinitions | Where-Object { $_ -ne 'ProtocolVersion' }) {
    if ($definitions.PSObject.Properties.Name -contains $messageName -and $definitions.$messageName.additionalProperties -ne $false) {
        $errors.Add("additionalProperties가 false가 아님: $messageName")
    }
}

$versionedMessages = @(
    'NetworkConnectionProfile',
    'NetworkCommandRequest',
    'NetworkCommandResult',
    'NetworkEvent',
    'NetworkStatus'
)
foreach ($messageName in $versionedMessages) {
    if ($definitions.PSObject.Properties.Name -contains $messageName -and @($definitions.$messageName.required) -notcontains 'protocolVersion') {
        $errors.Add("protocolVersion 필수 지정 없음: $messageName")
    }
}

if ($definitions.PSObject.Properties.Name -contains 'NetworkConnectionProfile') {
    $requiredProfileFields = @('profileId', 'mode', 'origin', 'commandBasePath', 'eventPath', 'statusPath', 'authMode')
    foreach ($fieldName in $requiredProfileFields) {
        if (@($definitions.NetworkConnectionProfile.required) -notcontains $fieldName) {
            $errors.Add("연결 교체 프로필 필드 없음: $fieldName")
        }
    }

    $profileProperties = $definitions.NetworkConnectionProfile.properties
    if ($profileProperties.commandBasePath.const -ne '/api/v1/commands') {
        $errors.Add('고정 command route가 아님: /api/v1/commands')
    }
    if ($profileProperties.eventPath.const -ne '/api/v1/events') {
        $errors.Add('고정 event route가 아님: /api/v1/events')
    }
    if ($profileProperties.statusPath.const -ne '/api/v1/network/status') {
        $errors.Add('고정 status route가 아님: /api/v1/network/status')
    }
    if (@($definitions.NetworkConnectionProfile.allOf).Count -ne 2) {
        $errors.Add('local/cloud 연결 프로필 제약이 모두 정의되지 않음')
    }
}

if ($definitions.PSObject.Properties.Name -contains 'NetworkStatus') {
    $statusProperties = $definitions.NetworkStatus.properties
    if ($statusProperties.commandChannel.const -ne 'http-json') {
        $errors.Add('명령 채널이 http-json으로 고정되지 않음')
    }
    if ($statusProperties.eventChannel.const -ne 'sse') {
        $errors.Add('이벤트 채널이 sse로 고정되지 않음')
    }
    if (@($definitions.NetworkStatus.allOf).Count -ne 2) {
        $errors.Add('local/cloud 공개 보안 상태 제약이 모두 정의되지 않음')
    }

    $forbiddenStatusFieldPattern = '(?i)(origin|host|port|endpoint|token|secret|credential|path|root|directory|connectionhandle)'
    foreach ($propertyName in @($statusProperties.PSObject.Properties.Name)) {
        if ($propertyName -match $forbiddenStatusFieldPattern) {
            $errors.Add("공개 NetworkStatus 금지 필드: $propertyName")
        }
    }
}

$runtimeReadmePath = Join-Path $projectRoot 'platform\network-runtime\README.md'
if (-not (Test-Path -LiteralPath $runtimeReadmePath)) {
    $errors.Add('NetworkRuntime 공개 경계 문서 없음')
}
else {
    $runtimeReadme = Get-Content -LiteralPath $runtimeReadmePath -Raw
    foreach ($operationName in @('ReplaceConnection', 'Send', 'Subscribe', 'Cancel', 'GetStatus', 'SubscribeStatus', 'Disconnect')) {
        if ($runtimeReadme -notmatch [regex]::Escape($operationName)) {
            $errors.Add("NetworkRuntime 공개 동작 문서 없음: $operationName")
        }
    }
}

if ($errors.Count -gt 0) {
    Write-Host 'Network Contract 검증 실패' -ForegroundColor Red
    foreach ($validationError in $errors) {
        Write-Host "- $validationError" -ForegroundColor Red
    }
    exit 1
}

Write-Host 'Network Contract 검증 성공' -ForegroundColor Green
Write-Host '접속 교체점: NetworkConnectionProfile'
Write-Host '명령/결과: HTTP JSON, 이벤트: SSE'
Write-Host '공개 상태: endpoint, port, token, path 비노출'
