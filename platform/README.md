# Platform

상태: `TARGET`

여러 제품 영역에서 공유하는 실행 기반을 둔다.

예정 영역:

- `network-runtime`: 접속 교체, HTTP JSON 명령·결과, 단일 SSE, 재연결과 상태 관측
- `execution`: Flow, Feature, Scope, Trace, 취소와 진행률
- `plugin-host`: 플러그인 프로세스 시작·감시·종료
- `plugin-runtime`: RPC, 권한, 이벤트와 호환성
- `updater`: 버전 검증, 활성 전환과 롤백

네트워크 사용은 `network-runtime/`만 소유한다. 다른 영역은 직접 연결을 생성하지 않고 NetworkRuntime 공개 동작을 사용한다.
