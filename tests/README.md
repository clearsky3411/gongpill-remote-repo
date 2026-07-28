# Tests

상태: `TARGET`

프로세스와 패키지 내부 단위 테스트는 가까운 위치에 두고, 이 폴더에는 경계를 넘는 검증을 둔다.

예정 영역:

- integration
- e2e
- fixtures
- migration
- failure-injection

현재 실행 가능한 단위 테스트:

```powershell
npm run test:network
```

구현 위치: `platform/network-runtime/test/network-runtime.test.ts`
