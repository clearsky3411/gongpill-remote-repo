# Tests

상태: `CURRENT` (부트스트랩·네트워크·프로젝트 문서 MVP 통합 테스트)

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
npm run test:mvp
npm run test:installer
npm run test:portable
npm run validate:release
```

부트스트랩 통합 테스트는 실제 Core 자식 프로세스와 loopback HTTP/SSE 연결, 후보 롤백, 시작 실패, 잔류 프로세스 정리를 검증한다.

MVP 통합 테스트는 프로젝트·문서 생성, 경로 경계, revision 충돌, 원자 저장과 history, 일회용 Browser 쿠키 세션, favicon, 실제 Client 진입점과 종료 정리를 검증한다. `tests/client`는 클라이언트(접속기)의 설치형·포터블 설정, 원자 덮어쓰기, 경로 경계와 실제 PowerShell 응답을 검증한다.

포터블 테스트는 실제 ZIP을 새 임시 폴더에 풀고 시스템 `PATH` 없이 포함 Node로 두 번 실행하여 데이터 재사용과 포터블 데이터 루트를 검증한다.

Installer 테스트는 Setup.exe를 임시 경로에 silent 설치하고 포함 Node로 프로젝트·문서를 만든 뒤 제거한다. 프로그램 경로 삭제와 사용자 데이터 보존을 확인하고 재설치 후 같은 데이터를 다시 읽은 다음 한 번 더 제거한다.

구현 위치:

- `tests/bootstrap/client-core-loopback-bootstrap.test.ts`
- `tests/mvp/project-document-mvp.test.ts`
- `tests/distribution/portable-package.test.ts`
- `tests/distribution/windows-installer.test.ts`
- `platform/network-runtime/test/network-runtime.test.ts`
- `platform/network-runtime/test/loopback-network-runtime.test.ts`
