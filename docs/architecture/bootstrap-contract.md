# Bootstrap Contract

상태: `CURRENT`

## 목적

Client, Core, Browser를 독립적으로 교체할 수 있도록 프로세스 경계를 버전 있는 계약으로 고정한다.

Client는 Core의 실제 버전 폴더와 프로세스 수명을 소유한다. Core는 자신의 버전과 지원 API를 보고한다. Browser는 실제 경로나 연결 비밀정보 없이 논리 세션만 받는다.

기계 판독 계약은 `packages/contracts/bootstrap/bootstrap-contracts.schema.json`에 있다.

## 계약 흐름

```text
Client
  ├─ ClientBootstrapConfig ───────────────> Core
  │                                         │
  │<──── CoreReadyInfo + NetworkProfile ────┤ stdout 1회
  │
  ├─ protocol과 health 검사
  ├─ CoreActivationResult 확정
  └─ BrowserSessionSummary ───────────────> Browser
```

## ClientBootstrapConfig

Client가 선택한 Core 프로세스에 전달하는 내부 계약이다.

현재 프로세스 경계에서는 Client가 이 JSON을 Core stdin에 한 줄로 한 번 전달한다. 세션 인증 토큰은 이 계약이나 명령행 인자에 넣지 않고 자식 프로세스 전용 `GONGPIL_LOOPBACK_SESSION_TOKEN` 환경변수로만 전달한다. Client 자신의 환경과 운영체제 전역 환경은 변경하지 않는다.

포함 정보:

- 계약 protocol version
- launch ID와 session ID
- 설치형/포터블 모드
- Client와 선택한 Core 버전
- Client가 지원하는 Core protocol 범위
- 프로그램·데이터·버전·세션 임시·포함 런타임 절대 경로
- 시작·업데이트·롤백 중 어떤 활성화인지 나타내는 이유
- 이전 Core 버전과 health check 필수 여부

이 계약은 Browser에 전달하지 않는다.

## CoreReadyInfo

Core가 초기화와 자기검증을 마친 뒤 Client에 반환한다.

Core stdout은 이 JSON 한 줄 전용이다. 진단 정보는 비밀정보와 절대 경로를 제거한 stderr로 분리하며, token은 stdout·stderr·Browser 요약 어디에도 기록하지 않는다.

포함 정보:

- 실제 실행된 Core 버전
- Core API 버전
- Core가 사용하는 protocol version
- health 상태
- Client의 NetworkRuntime만 사용하는 `NetworkConnectionProfile`
- 지원 capability ID 목록

Core는 스스로 활성 버전을 변경하지 않는다. 어떤 버전을 활성화할지는 Client가 결정한다.

## CoreActivationResult

Client가 호환성과 health 검사를 마친 결과다.

- 후보 Core가 허용되면 새 버전을 활성 상태로 확정한다.
- protocol major가 다르거나 minor가 지원 범위를 벗어나면 거부한다.
- health가 `ready`가 아니면 기본적으로 활성화하지 않는다.
- 업데이트 후보가 거부되면 기존 활성 버전을 유지하고 `rollbackRequired`를 표시한다.
- 활성 버전 포인터는 후보 프로세스 검증이 끝난 뒤에만 원자적으로 전환한다.

## BrowserSessionSummary

Browser에 공개되는 최소 논리 계약이다.

허용 정보:

- session ID
- 설치형/포터블 표시
- Core 준비·실패·롤백 상태
- 표시용 Core와 API 버전
- 활성 프로젝트 ID와 표시 이름
- 읽기 전용 여부
- 업데이트 표시 상태
- UI가 사용할 수 있는 capability ID

금지 정보:

- 프로그램·데이터·버전·세션 임시 경로
- 파일 또는 디렉터리 절대 경로
- 프로세스 실행 파일과 포함 런타임 위치
- endpoint, token, secret, credential
- Client 내부 NetworkConnectionProfile

Browser는 Core가 제공하는 same-origin UI에서 NetworkRuntime을 사용하며 연결 비밀정보를 직접 조합하지 않는다.

## 호환성 규칙

protocol version은 `major.minor` 의미를 가진 두 정수로 표현한다.

```text
Core.major == Client.supportedCoreProtocol.major
Client.minMinor <= Core.minor <= Client.maxMinor
```

- major 불일치는 시작 거부와 이전 Core 유지 대상이다.
- 지원 범위 밖 minor는 자동 활성화하지 않는다.
- Core API version은 Browser 기능 표시와 capability 판정에 사용한다.
- 필드 추가는 `additionalProperties: false` 계약을 바꾸므로 protocol minor 변경 검토가 필요하다.
- 필드 제거·의미 변경은 protocol major 변경 대상으로 검토한다.

## 오류 공개 규칙

Browser에 전달 가능한 `BootstrapError`는 안정적인 code, 사용자 메시지, 재시도 가능 여부와 선택적 trace ID만 가진다.

내부 stack, 절대 경로, endpoint, token과 원본 오류 객체는 로그의 비밀정보 제거 단계를 거치기 전까지 Browser에 전달하지 않는다.

## 확정된 네트워크 경계

- 로컬 transport는 `127.0.0.1` 동적 port의 loopback TCP다.
- 명령과 최종 결과는 HTTP JSON, 진행률과 상태 이벤트는 단일 SSE stream을 사용한다.
- Core는 표준 출력의 한 줄 JSON으로 `CoreReadyInfo`를 Client에 한 번 전달한다.
- Client는 `NetworkRuntime.ReplaceConnection`으로 후보 접속을 검증한 후 교체한다.
- 클라우드는 같은 route와 메시지 계약을 HTTPS와 HTTP/2로 제공한다.

상세 계약은 `network-runtime.md`와 `packages/contracts/network/network-contracts.schema.json`에서 확인한다.

## 미결정 사항

- 활성 버전 포인터의 파일 형식과 원자 전환 구현
- 서명과 체크섬 검증 주체의 세부 분담

이 항목은 현재 계약의 논리 경계를 바꾸지 않는 별도 ADR에서 확정한다.
