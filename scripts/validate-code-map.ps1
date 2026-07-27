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
$allowedStatuses = @('CURRENT', 'TARGET', 'TBD', 'PROPOSED', 'DEFERRED', 'LEGACY', 'REJECTED')

if ($registry.schemaVersion -ne 1) {
    $errors.Add("지원하지 않는 schemaVersion: $($registry.schemaVersion)")
}

$components = @($registry.components)
$features = @($registry.features)
$componentById = @{}
$featureById = @{}

foreach ($component in $components) {
    if ($componentById.ContainsKey($component.id)) {
        $errors.Add("중복 컴포넌트 ID: $($component.id)")
        continue
    }

    $componentById[$component.id] = $component

    if ($allowedStatuses -notcontains $component.status) {
        $errors.Add("잘못된 컴포넌트 상태: $($component.id) = $($component.status)")
    }

    if ([System.IO.Path]::IsPathRooted([string]$component.path) -or ([string]$component.path -match '(^|[\\/])\.\.([\\/]|$)')) {
        $errors.Add("컴포넌트 경로는 프로젝트 내부 상대 경로여야 함: $($component.id) = $($component.path)")
        continue
    }

    $componentPath = Join-Path $projectRoot ([string]$component.path)
    if (-not (Test-Path -LiteralPath $componentPath)) {
        $errors.Add("컴포넌트 경로 없음: $($component.id) = $($component.path)")
    }
}

foreach ($component in $components) {
    foreach ($dependencyId in @($component.dependsOn)) {
        if (-not $componentById.ContainsKey($dependencyId)) {
            $errors.Add("알 수 없는 dependsOn ID: $($component.id) -> $dependencyId")
            continue
        }

        if ($dependencyId -eq $component.id) {
            $errors.Add("자기 자신을 의존함: $($component.id)")
        }

        $dependency = $componentById[$dependencyId]
        if (@($dependency.usedBy) -notcontains $component.id) {
            $errors.Add("비대칭 관계: $($component.id) dependsOn $dependencyId, 하지만 usedBy에 없음")
        }
    }

    foreach ($consumerId in @($component.usedBy)) {
        if (-not $componentById.ContainsKey($consumerId)) {
            $errors.Add("알 수 없는 usedBy ID: $($component.id) <- $consumerId")
            continue
        }

        $consumer = $componentById[$consumerId]
        if (@($consumer.dependsOn) -notcontains $component.id) {
            $errors.Add("비대칭 관계: $($component.id) usedBy $consumerId, 하지만 dependsOn에 없음")
        }
    }
}

foreach ($feature in $features) {
    if ($featureById.ContainsKey($feature.id)) {
        $errors.Add("중복 기능 ID: $($feature.id)")
        continue
    }

    $featureById[$feature.id] = $feature

    if ($allowedStatuses -notcontains $feature.status) {
        $errors.Add("잘못된 기능 상태: $($feature.id) = $($feature.status)")
    }

    if (-not $componentById.ContainsKey($feature.ownerComponentId)) {
        $errors.Add("기능 소유 컴포넌트 없음: $($feature.id) -> $($feature.ownerComponentId)")
    }

    if ([System.IO.Path]::IsPathRooted([string]$feature.path) -or ([string]$feature.path -match '(^|[\\/])\.\.([\\/]|$)')) {
        $errors.Add("기능 경로는 프로젝트 내부 상대 경로여야 함: $($feature.id) = $($feature.path)")
        continue
    }

    $featurePath = Join-Path $projectRoot ([string]$feature.path)
    if (-not (Test-Path -LiteralPath $featurePath)) {
        $errors.Add("기능 경로 없음: $($feature.id) = $($feature.path)")
    }
}

foreach ($activeComponentId in @($registry.workTracking.activeComponentIds)) {
    if (-not $componentById.ContainsKey($activeComponentId)) {
        $errors.Add("활성 컴포넌트 ID 없음: $activeComponentId")
    }
}

foreach ($activeFeatureId in @($registry.workTracking.activeFeatureIds)) {
    if (-not $featureById.ContainsKey($activeFeatureId)) {
        $errors.Add("활성 기능 ID 없음: $activeFeatureId")
    }
}

$gitDirectory = Join-Path $projectRoot '.git'
if (Test-Path -LiteralPath $gitDirectory) {
    $actualBranch = (& git -C $projectRoot branch --show-current 2>$null).Trim()
    if ($LASTEXITCODE -ne 0) {
        $errors.Add('현재 Git 브랜치를 확인하지 못함')
    }
    elseif ($actualBranch -ne $registry.workTracking.branch) {
        $errors.Add("workTracking 브랜치 불일치: registry=$($registry.workTracking.branch), actual=$actualBranch")
    }
}

if ($errors.Count -gt 0) {
    Write-Host 'Code Map 검증 실패' -ForegroundColor Red
    foreach ($validationError in $errors) {
        Write-Host "- $validationError" -ForegroundColor Red
    }
    exit 1
}

Write-Host "Code Map 검증 성공: 컴포넌트 $($components.Count)개, 기능 $($features.Count)개" -ForegroundColor Green
Write-Host "현재 작업: $($registry.workTracking.activeWorkUnit)"
Write-Host "활성 컴포넌트: $(@($registry.workTracking.activeComponentIds) -join ', ')"
Write-Host "활성 기능: $(@($registry.workTracking.activeFeatureIds) -join ', ')"
