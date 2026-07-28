# Core

상태: `CURRENT` (부트스트랩 수직 슬라이스)

Core는 공필 데이터와 권한을 최종 집행하는 프로세스다.

## 책임

- 프로젝트 열기·닫기와 읽기 전용 상태
- 문서·자산·채팅·페르소나 저장
- 안정적인 ID와 revision
- 변경 제안, diff, 승인, 충돌 검사와 원자적 저장
- 플러그인 권한과 이벤트 집행
- 백업·복구와 파생 데이터 재생성
- 시작 시 자신의 Core·API·protocol 버전과 health를 Client에 보고
- NetworkRuntime host로 모든 명령 수신, 결과·이벤트 송신과 상태 집계

## 경계

- 경로 기준은 Client가 전달한 부트스트랩 정보에서 받는다.
- Browser 요청을 스키마와 권한으로 검증한다.
- route, HTTP JSON, SSE와 접속 상태 처리는 NetworkRuntime 밖으로 분산하지 않는다.
- Browser 자산과 API를 같은 origin에서 제공한다.
- 플러그인이 원본 파일에 직접 접근하지 못하게 한다.
- Core는 자신의 버전 폴더나 활성 버전 포인터를 직접 변경하지 않는다.

## 현재 구현

`src/core-process.ts`는 stdin의 `ClientBootstrapConfig` 한 줄을 검증하고 필요한 session 디렉터리를 준비한다. 세션 토큰은 자식 프로세스 환경에서만 읽으며, 실제 loopback host를 시작한 뒤 stdout에 `CoreReadyInfo` JSON 한 줄만 기록한다. `system.health.read`와 `system.readiness.verify`가 현재 최소 명령이다.

프로젝트 문서·revision·권한·제안 저장 기능은 아직 목표 상태다.
