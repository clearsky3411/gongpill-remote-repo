[CmdletBinding()]
param(
    [string]$RegistryPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ([string]::IsNullOrWhiteSpace($RegistryPath)) {
    $RegistryPath = Join-Path $projectRoot 'docs\architecture\component-registry.json'
}

$resolvedRegistryPath = (Resolve-Path -LiteralPath $RegistryPath).Path
$registry = Get-Content -LiteralPath $resolvedRegistryPath -Raw | ConvertFrom-Json
$errors = [System.Collections.Generic.List[string]]::new()
$runtimeComponentId = 'gongpil.network-runtime'
$allowedUsageKinds = @('none', 'command', 'event-stream', 'both', 'external')

if ($null -eq $registry.PSObject.Properties['networkTracking']) {
    $errors.Add('networkTracking 정본 없음')
}
else {
    $tracking = $registry.networkTracking
    if ($tracking.runtimeComponentId -ne $runtimeComponentId) {
        $errors.Add("NetworkRuntime 소유자 불일치: $($tracking.runtimeComponentId)")
    }
    if ($tracking.commandChannel -ne 'http-json') {
        $errors.Add('명령 채널이 http-json으로 고정되지 않음')
    }
    if ($tracking.eventChannel -ne 'sse') {
        $errors.Add('이벤트 채널이 sse로 고정되지 않음')
    }
    if ($tracking.localTransport -ne 'loopback-tcp') {
        $errors.Add('로컬 transport가 loopback-tcp로 고정되지 않음')
    }
    if ($tracking.cloudTransport -ne 'https') {
        $errors.Add('클라우드 transport가 https로 고정되지 않음')
    }
}

$componentIds = @($registry.components | ForEach-Object { $_.id })
if ($componentIds -notcontains $runtimeComponentId) {
    $errors.Add("NetworkRuntime 컴포넌트 없음: $runtimeComponentId")
}

foreach ($feature in @($registry.features)) {
    if ($null -eq $feature.PSObject.Properties['networkUsage']) {
        $errors.Add("기능 networkUsage 없음: $($feature.id)")
        continue
    }

    $usage = $feature.networkUsage
    if ($allowedUsageKinds -notcontains $usage.kind) {
        $errors.Add("잘못된 networkUsage.kind: $($feature.id) = $($usage.kind)")
        continue
    }

    $commands = @($usage.commands)
    $events = @($usage.events)
    if ($usage.kind -eq 'none') {
        if ($null -ne $usage.ownerComponentId) {
            $errors.Add("networkUsage none 기능에 소유자가 있음: $($feature.id)")
        }
        if ($commands.Count -gt 0 -or $events.Count -gt 0) {
            $errors.Add("networkUsage none 기능에 명령 또는 이벤트가 있음: $($feature.id)")
        }
        continue
    }

    if ($usage.ownerComponentId -ne $runtimeComponentId) {
        $errors.Add("네트워크 사용 기능의 소유점 불일치: $($feature.id) = $($usage.ownerComponentId)")
    }
    if (($usage.kind -eq 'command' -or $usage.kind -eq 'both') -and $commands.Count -eq 0) {
        $errors.Add("명령 사용 기능에 commands 없음: $($feature.id)")
    }
    if (($usage.kind -eq 'event-stream' -or $usage.kind -eq 'both') -and $events.Count -eq 0) {
        $errors.Add("이벤트 사용 기능에 events 없음: $($feature.id)")
    }
    if ($usage.kind -eq 'command' -and $events.Count -gt 0) {
        $errors.Add("command 전용 기능에 events가 있음: $($feature.id)")
    }
    if ($usage.kind -eq 'event-stream' -and $commands.Count -gt 0) {
        $errors.Add("event-stream 전용 기능에 commands가 있음: $($feature.id)")
    }
}

$runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'platform\network-runtime'))
$sourceExtensions = @('.ts', '.tsx', '.js', '.jsx', '.cs', '.cpp', '.h', '.hpp', '.rs', '.go')
$directNetworkPatterns = @(
    '(?i)(\bfetch\s*\(|new\s+EventSource\b|new\s+WebSocket\b|\bHttpClient\b|\bTcpClient\b|\bTcpListener\b|\bNamedPipe(Client|Server)?Stream\b)',
    '(?i)(?:from\s+|require\s*\(\s*)["''](?:node:)?(?:http|https|http2|net|tls|dgram)["'']',
    '(?i)(?:from\s+|require\s*\(\s*)["''](?:axios|undici|node-fetch|ws)["'']'
)
$scanRoots = @('client', 'core', 'browser', 'platform', 'builtin-plugins')

foreach ($scanRoot in $scanRoots) {
    $rootPath = Join-Path $projectRoot $scanRoot
    if (-not (Test-Path -LiteralPath $rootPath)) {
        continue
    }

    foreach ($sourceFile in Get-ChildItem -LiteralPath $rootPath -Recurse -File) {
        if ($sourceExtensions -notcontains $sourceFile.Extension.ToLowerInvariant()) {
            continue
        }
        if ($sourceFile.FullName.StartsWith($runtimeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            continue
        }

        $directUsage = Select-String -LiteralPath $sourceFile.FullName -Pattern $directNetworkPatterns
        if ($null -ne $directUsage) {
            $relativePath = $sourceFile.FullName.Substring($projectRoot.Length).TrimStart('\', '/')
            $errors.Add("NetworkRuntime 밖의 직접 네트워크 사용: $relativePath")
        }
    }
}

if ($errors.Count -gt 0) {
    Write-Host 'Network Map 검증 실패' -ForegroundColor Red
    foreach ($validationError in $errors) {
        Write-Host "- $validationError" -ForegroundColor Red
    }
    exit 1
}

$networkFeatureCount = @($registry.features | Where-Object { $_.networkUsage.kind -ne 'none' }).Count
Write-Host "Network Map 검증 성공: 네트워크 사용 기능 ${networkFeatureCount}개" -ForegroundColor Green
Write-Host "유일한 소유자: $runtimeComponentId"
Write-Host '명령/결과: http-json, 이벤트: sse, 로컬: loopback-tcp, 클라우드: https'
