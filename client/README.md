# Client

상태: `CURRENT` (실제 사용자 진입점과 Core 수명 관리)

Client는 Browser가 열리기 전에 존재하는 공필의 부트스트랩 인스턴스다.

## 책임

- 설치형과 포터블 실행 모드 판정
- 프로그램·데이터·활성 버전·세션 임시 루트 결정
- 포함 런타임 위치 결정
- Core 프로세스 시작, health check, 종료와 잔류 프로세스 검사
- 후보 Core의 protocol·버전·health 검사 후 활성화 또는 이전 버전 유지
- Core 표준 출력에서 후보 NetworkConnectionProfile 수신
- 단일 NetworkRuntime으로 후보 접속 검증, 활성 교체와 기존 접속 유지
- 데스크톱 창과 Browser 수명 관리

## 경계

- Client는 사용자 문서를 직접 해석하거나 수정하지 않는다.
- 확정한 경로는 Core에만 전달한다.
- Browser에는 절대 경로와 NetworkConnectionProfile 대신 논리적인 세션 상태만 제공한다.
- Client 기능은 주소나 HTTP client를 직접 다루지 않고 NetworkRuntime을 사용한다.
- 후보 접속이 ready가 아니면 기존 NetworkRuntime 연결을 유지한다.
- 실행 중인 Core 파일을 덮어쓰지 않고 버전 폴더를 나란히 유지한다.
- 활성 버전 포인터는 후보 Core 검증 뒤에만 전환한다.

## 현재 구현

- `src/bootstrap-paths.ts`: 설치형·포터블 app/data/version/session/runtime 경로 결정
- `src/core-process-manager.ts`: 지정된 runtime으로 Core 시작, stdout 한 줄 준비 계약 수신, 정상·강제 종료
- `src/client-bootstrap.ts`: protocol·버전·health 검증, NetworkRuntime 후보 교체, 실패 시 기존 Core 유지
- `src/client-process.ts`: `npm start` 사용자 진입점, Core 활성화, 일회용 Browser 세션 생성, 기본 Browser 실행과 종료 대기
- `demo/client-core-loopback-bootstrap-demo.ts`: 실제 자식 프로세스, HTTP/SSE 접속, 롤백과 잔류 프로세스 0개 확인

현재 `npm start`는 시스템 Node를 runtime으로 사용한다. Node runtime을 포함한 포터블·설치형 패키지와 네이티브 데스크톱 창은 후속 작업이다.
