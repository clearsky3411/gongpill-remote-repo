# Network Map

상태: `CURRENT`

네트워크 사용 위치의 기계 판독 정본은 `component-registry.json`의 `networkTracking`과 각 기능의 `networkUsage`다.

## 고정 소유자

| 항목 | 값 |
|---|---|
| 유일한 소유 컴포넌트 | `gongpil.network-runtime` |
| 접속 교체 | `NetworkRuntime.ReplaceConnection` |
| 송신·최종 결과 | `NetworkRuntime.Send` |
| 이벤트 수신 | `NetworkRuntime.Subscribe` |
| 상태 확인 | `NetworkRuntime.GetStatus`, `SubscribeStatus` |
| 명령 채널 | `http-json` |
| 이벤트 채널 | `sse` |
| 로컬 transport | `loopback-tcp` |
| 클라우드 transport | `https` |

## 사용 분류

| 값 | 의미 |
|---|---|
| `none` | 네트워크를 사용하지 않음 |
| `command` | 명령·최종 결과만 사용 |
| `event-stream` | 이벤트 구독만 사용 |
| `both` | 명령·결과와 이벤트를 모두 사용 |
| `external` | 외부 서비스를 Network Runtime adapter로 사용 |

## 현재 등록 기능

| 기능 ID | 사용 | 명령 | 이벤트 |
|---|---|---|---|
| `bootstrap.core.lifecycle` | `command` | `system.health.read` | - |
| `bootstrap.core.version-activation` | `command` | `system.readiness.verify` | - |
| `browser.presence.lifecycle` | `both` | `browser.presence.ack` | `browser.presence.ping` |
| `project.document.revision` | `both` | `document.read`, `document.save` | `document.changed` |
| `ai.openai.responses` | `external` | `responses.create` | `response.output_text.delta` |
| `chat.session.persist` | `both` | `chat.session.read`, `chat.message.send` | `chat.message.delta`, `chat.message.completed`, `proposal.created` |
| `document.proposal.apply` | `both` | `proposal.apply` | `proposal.applied` |
| `ui.shell` | `both` | `session.read` | `network.status.changed` |
| `ui.ai-collaboration` | `both` | `chat.session.read`, `chat.message.send`, `proposal.apply`, `proposal.reject` | `chat.message.delta`, `chat.message.completed`, `proposal.created`, `proposal.applied`, `proposal.rejected` |
| `plugin.runtime` | `both` | `plugin.invoke` | `plugin.event` |
| `plugin.markdown-editor` | `both` | `document.read`, `document.save` | `document.changed` |
| `network.runtime.facade` | `both` | `network.command.dispatch` | `network.event.dispatch` |
| `network.status.observe` | `both` | `network.status.read` | `network.status.changed` |
| `network.demo.cli` | `both` | `demo.echo` | `demo.progress` |
| `network.host.loopback-http` | `both` | `network.command.host` | `network.event.host` |
| `network.transport.loopback-http` | `both` | `network.command.transport` | `network.event.transport` |
| `network.event.sse` | `event-stream` | - | `network.event.stream` |
| `network.demo.loopback` | `both` | `demo.echo` | `demo.progress` |

표에 없는 현재 기능은 `networkUsage.kind`가 `none`이다. 새 기능이 네트워크를 사용하면 구현과 동시에 이 지도와 registry를 갱신한다.

검증 명령:

```powershell
& .\scripts\validate-network-map.ps1
```

실행 가능한 상태 확인:

```powershell
npm run demo:network
npm run demo:network:loopback
```

loopback 확인판에서 실제 동적 포트, 활성·후보 profile, 단일 SSE stream, 재접속과 마지막 오류를 확인할 수 있다.
