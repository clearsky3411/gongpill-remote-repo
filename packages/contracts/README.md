# Process Contracts

상태: `CURRENT`

Client, Core, Browser와 향후 플러그인 프로세스 사이에 전달되는 버전 있는 계약을 둔다.

## 규칙

- 프로세스 내부 구현 타입을 그대로 외부 계약으로 노출하지 않는다.
- 모든 최상위 메시지는 `protocolVersion`을 가진다.
- Client-Core 계약과 Browser 공개 계약을 분리한다.
- 모든 네트워크 명령, 결과, 이벤트와 상태는 NetworkRuntime 계약을 사용한다.
- Browser 공개 계약에는 절대 경로, endpoint, 인증 token과 실행 파일 위치를 넣지 않는다.
- 계약 변경은 호환성 영향과 지원 범위를 Code Map에 기록한다.
- Core 후보 버전은 Client가 계약 호환성과 health를 확인한 뒤에만 활성화한다.

## 첫 계약 범위

- `ClientBootstrapConfig`
- `CoreReadyInfo`
- `CoreActivationResult`
- `BrowserSessionSummary`
- `BootstrapError`

## Network Runtime 계약

- `NetworkConnectionProfile`: Client와 NetworkRuntime 전용 접속 교체 정보
- `NetworkCommandRequest`, `NetworkCommandResult`: HTTP JSON 명령과 최종 결과
- `NetworkEvent`: 단일 SSE stream 이벤트
- `NetworkStatus`: Browser에도 공개 가능한 비밀정보 제거 상태
- `NetworkError`: 안정적인 공개 오류

기계 정본: `bootstrap/bootstrap-contracts.schema.json`

실행 타입과 경계 파서: `bootstrap/contracts.ts`

네트워크 기계 정본: `network/network-contracts.schema.json`

검증: `scripts/validate-bootstrap-contract.ps1`

네트워크 검증: `scripts/validate-network-contract.ps1`
