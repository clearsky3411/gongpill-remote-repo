# Network Runtime

상태: `CURRENT` facade·상태 머신·in-memory transport·loopback HTTP/SSE 수직 슬라이스

## 결정

공필 네트워킹 v1은 `HTTP JSON + SSE`로 고정한다. 로컬과 클라우드는 주소와 인증 방식만 다르고 명령, 결과, 이벤트, 오류와 상태 계약은 같다.

```text
Local
Browser ── HTTP JSON + SSE ── Core(127.0.0.1:dynamic)
   ▲                              ▲
   └──── same-origin UI ──────────┘
                                  │ stdout readiness 1회
                                Client

Cloud
Browser ── HTTPS JSON + SSE ── Gateway ── Core
```

Named Pipe와 WebSocket은 v1에서 사용하지 않는다. 실시간 공동 편집처럼 고빈도 양방향 통신이 실제 요구사항이 되면 기존 코드에 몰래 추가하지 않고 별도 ADR과 protocol version 검토를 거친다.

## 하나의 객체가 의미하는 것

운영체제 프로세스를 가로질러 같은 메모리 객체를 공유할 수는 없다. 대신 `gongpil.network-runtime`이 유일한 네트워크 소유자이며, 각 프로세스는 자신의 역할에 맞는 `NetworkRuntime` 인스턴스를 하나만 가진다.

```ts
interface NetworkRuntime {
  ReplaceConnection(profile: NetworkConnectionProfile): Promise<NetworkStatus>;
  Send(commandName: string, payload: NetworkPayload): Promise<NetworkCommandResult>;
  Subscribe(listener: (event: NetworkEvent) => void): Unsubscribe;
  Cancel(requestId: string): Promise<NetworkCommandResult>;
  GetStatus(): NetworkStatus;
  SubscribeStatus(listener: (status: NetworkStatus) => void): Unsubscribe;
  Disconnect(): Promise<void>;
}
```

- consumer 역할: Client와 Browser의 모든 송신·수신·재연결·상태 집계
- host 역할: Core의 모든 route 수신, 명령 dispatch, 결과·이벤트 송신과 상태 집계
- 기능 코드: 위 공개 동작만 호출하며 transport를 알지 않음

`ReplaceConnection`은 새 프로필을 검증하고 연결한 뒤 준비 상태가 확인된 경우에만 활성 프로필을 원자적으로 바꾼다. 실패하면 기존 프로필과 연결을 유지한다.

## 고정 route

| 용도 | 방식 | Route | 반환 |
|---|---|---|---|
| 생존 확인 | GET | `/api/v1/health/live` | 프로세스 생존 |
| 준비 확인 | GET | `/api/v1/health/ready` | protocol·Core 준비 상태 |
| 상태 확인 | GET | `/api/v1/network/status` | 비밀정보 제거 `NetworkStatus` |
| 명령과 최종 결과 | POST | `/api/v1/commands/{commandName}` | `NetworkCommandResult` |
| 진행률·상태 이벤트 | GET | `/api/v1/events` | 단일 SSE stream |
| 요청 취소 | POST | `/api/v1/requests/{requestId}/cancel` | `NetworkCommandResult` |

기능 관점에서 결과가 들어오는 지점은 항상 `Send`의 반환값이고, 진행 이벤트가 들어오는 지점은 항상 `Subscribe`다. HTTP 응답 parsing, SSE parsing, request ID correlation과 오류 변환은 Network Runtime 밖으로 나오지 않는다.

## 접속 교체

`NetworkConnectionProfile`은 Client와 Network Runtime만 사용하는 내부 계약이다.

```text
profileId
mode: local | cloud
origin
commandBasePath
eventPath
statusPath
authMode
protocolVersion
```

로컬에서 Core는 `127.0.0.1`과 port `0`으로 시작하여 운영체제에서 빈 포트를 할당받는다. 초기화가 끝나면 `CoreReadyInfo`를 표준 출력의 한 줄 JSON으로 Client에 전달한다. Client는 후보 연결을 Network Runtime에 전달하고 readiness와 protocol을 확인한 뒤에만 활성화한다.

Browser는 연결 프로필을 메시지로 받지 않는다. Client는 Core가 제공하는 same-origin Browser UI를 열며, Browser 내부 Network Runtime이 현재 origin을 사용한다. 일반 기능 코드는 origin을 읽지 않는다.

Core host는 단일 SSE stream으로 10초마다 내부 `gongpil-heartbeat` ping을 보내고 Browser Network Runtime은 `browser.presence.ack`로 응답한다. 이 내부 ping은 공개 기능 이벤트로 전달하지 않는다. Browser 세션을 만든 뒤 시작 유예 동안 첫 ACK가 없거나 마지막 ACK 이후 3회 분량의 heartbeat가 누락되면 Core가 Instance Runtime을 정상 종료한다. PC 절전처럼 송신자와 수신자의 이벤트 루프가 함께 오래 멈춘 경우에는 재개 직후 바로 만료시키지 않고 새 heartbeat 기회를 준다. Client Runtime은 이 정책의 종료 대상이 아니다.

클라우드는 동일한 route를 HTTPS로 노출한다. Gateway가 TLS와 외부 인증을 종료하더라도 Core 명령·결과·이벤트 계약은 바뀌지 않는다.

## 상태 관측

상태 전이는 한곳에서만 계산한다.

```text
starting → connecting → ready
                    ↘ degraded
ready/degraded → reconnecting → ready
                           ↘ offline → failed
```

`NetworkStatus`는 mode, state, 활성·후보 profile ID, 고정 channel, 보안 모드, Core/API 버전, heartbeat, 지연 시간, 활성 요청 수, 단일 stream 상태, 재연결 횟수와 마지막 오류·trace ID를 제공한다. 교체 중에는 기존 `activeProfileId`와 새 `pendingProfileId`가 구분된다.

주소, port, token, credential과 저장 경로는 공개 상태에 포함하지 않는다. Browser는 이 상태를 사용해 연결됨·재연결 중·오프라인·실패를 표시한다. 상세 연결 값은 명시적인 개발자 진단에서만 비밀정보 제거 후 로그로 확인한다.

## 파편화 방지

1. 기능은 Code Map에 `networkUsage`를 등록한다.
2. Network Runtime 밖에서 직접 네트워크 API를 사용하는 source file은 검증 실패다.
3. 이벤트는 기능별 연결이 아니라 세션당 SSE stream 하나를 공유한다.
4. 재연결, backoff, heartbeat, 인증 갱신과 오류 정규화는 기능별로 구현하지 않는다.
5. 외부 서비스 연결도 `external` 사용으로 등록하고 Network Runtime adapter를 통한다.

## 작게 검증하는 순서

1. JSON 계약과 공개 상태 금지 필드를 정적 검증한다.
2. 상태 전이 reducer를 순수 단위 테스트로 검증한다.
3. in-memory host/consumer로 Send와 결과 correlation을 검증한다.
4. loopback HTTP와 단일 SSE 재연결을 통합 테스트한다.
5. Browser 상태 표시를 수동·E2E로 확인한다.
6. 후보 Core 접속 교체 실패 시 기존 연결 유지 여부를 장애 주입으로 확인한다.
7. 로컬 reverse proxy로 cloud profile과 같은 계약을 확인한다.

현재는 1~4단계와 6단계인 계약, 상태 reducer, 단일 facade, 실제 loopback HTTP JSON, 세션당 단일 SSE 재접속, Browser heartbeat ACK와 후보 실패 롤백까지 구현했다. `npm run demo:network:loopback`에서 OS가 할당한 포트와 상태 전이를 직접 확인하고, `npm run test:network`에서 단위·통합 검증을 함께 실행한다. cloud adapter는 이 수직 슬라이스의 범위 밖이다.
