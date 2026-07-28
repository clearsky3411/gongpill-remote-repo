# Network Runtime

상태: `CURRENT` facade·상태 머신·in-memory transport·loopback HTTP/SSE 수직 슬라이스

`NetworkRuntime`은 공필에서 접속 교체, 명령 송신, 결과 수신, 이벤트 구독과 네트워크 상태 관측을 소유하는 유일한 컴포넌트다.

## 단일 진입점

기능 코드는 다음 공개 동작만 사용한다.

- `ReplaceConnection`: 검증된 연결 프로필로 접속 대상을 원자적으로 교체한다.
- `Send`: 명령을 보내고 정규화된 최종 결과를 반환한다.
- `Subscribe`: Core 이벤트를 구독한다.
- `Cancel`: 진행 중인 요청의 취소를 요청한다.
- `GetStatus`: 현재 네트워크 상태 snapshot을 반환한다.
- `SubscribeStatus`: 상태 변경을 구독한다.
- `Disconnect`: 활성 접속을 정리하고 상태를 offline으로 전환한다.

각 프로세스는 자신의 역할에 맞는 `NetworkRuntime` 인스턴스를 정확히 하나만 생성한다. Browser와 Client는 consumer 역할을, Core는 host 역할을 사용한다. 프로세스가 다르므로 메모리 객체는 서로 다르지만 계약, 상태 모델, 관측 지점과 소유 컴포넌트는 하나다.

## 고정 프로토콜

- 명령과 최종 결과: HTTP JSON request/response
- 진행률과 상태 이벤트: 단일 SSE stream
- 로컬: `127.0.0.1`의 OS 할당 동적 포트
- 클라우드: 같은 route 계약을 HTTPS와 HTTP/2로 제공
- Core 준비 정보: 표준 출력의 한 줄 JSON으로 Client에 한 번 전달

Named Pipe와 WebSocket은 v1 런타임에 포함하지 않는다. 기능 코드가 `fetch`, `EventSource`, `WebSocket`, 임의 HTTP client나 socket을 직접 생성하는 것도 허용하지 않는다.

## 소유 경계

- 연결 주소, 인증, 재연결, request/event correlation과 오류 정규화는 Network Runtime 내부 정보다.
- Browser 기능은 endpoint, port, token과 저장 경로를 받지 않는다.
- Core가 Browser 자산을 같은 origin에서 제공하여 로컬과 클라우드의 호출 형태를 맞춘다.
- 모든 네트워크 사용 기능은 Code Map의 `networkUsage`에 등록한다.

기계 판독 계약은 `packages/contracts/network/network-contracts.schema.json`, 사용 위치 정본은 `docs/architecture/component-registry.json`에 있다.

## 지금 확인하기

외부 npm 패키지 설치 없이 실행한다.

```powershell
npm run demo:network
npm run demo:network:loopback
npm run test:network
```

`demo:network`는 빠른 in-memory 확인판이다. `demo:network:loopback`은 실제 `127.0.0.1` 동적 포트에서 HTTP JSON 명령·결과, 세션당 단일 SSE, 강제 단절 후 재접속, 준비되지 않은 후보 접속의 원자적 롤백을 차례로 보여준다. 두 경로 모두 기능 코드에는 transport를 노출하지 않고 `GongpilNetworkRuntime` facade를 사용한다.
