# Tests

상태: `CURRENT` (부트스트랩 통합 테스트)

프로세스와 패키지 내부 단위 테스트는 가까운 위치에 두고, 이 폴더에는 경계를 넘는 검증을 둔다.

예정 영역:

- integration
- e2e
- fixtures
- migration
- failure-injection

현재 실행 가능한 테스트:

```powershell
npm run test:bootstrap
npm run test:network
```

부트스트랩 통합 테스트는 실제 Core 자식 프로세스와 loopback HTTP/SSE 연결, 후보 롤백, 시작 실패, 잔류 프로세스 정리를 검증한다.

구현 위치:

- `tests/bootstrap/client-core-loopback-bootstrap.test.ts`
- `platform/network-runtime/test/network-runtime.test.ts`
- `platform/network-runtime/test/loopback-network-runtime.test.ts`
