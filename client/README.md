# Client

상태: `CURRENT` (실제 사용자 진입점과 Core 수명 관리)

Client는 인스턴스(브라우저 작업 화면)가 열리기 전에 데이터 위치와 실행 옵션을 정하는 Windows 접속기이자 부트스트랩 프로세스다.

## 책임

- 설치형과 포터블 실행 모드 판정
- 첫 실행·설정 바로가기에서 데이터 폴더와 접속기 표시 옵션 제공
- 설정 경로 검증과 원자 저장, 포터블 `GongpilData` 고정
- 프로그램·데이터·활성 버전·세션 임시 루트 결정
- 포함 런타임 위치 결정
- Core 프로세스 시작, health check, 종료와 잔류 프로세스 검사
- 후보 Core의 protocol·버전·health 검사 후 활성화 또는 이전 버전 유지
- Core 표준 출력에서 후보 NetworkConnectionProfile 수신
- 단일 NetworkRuntime으로 후보 접속 검증, 활성 교체와 기존 접속 유지
- Windows 접속기와 인스턴스 수명 관리

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
- `src/client-settings-store.ts`: 설치형·포터블 설정 로드, 경로·쓰기 가능성 검증과 원자 저장
- `src/client-connector.ts`: Node 프로세스와 Windows 접속기 UI의 JSON 교환·수명 관리
- `windows/GongpilConnector.ps1`: 폴더 선택, 시작 옵션, 실행 정보와 인스턴스 시작 WinForms UI
- `src/core-process-manager.ts`: 지정된 runtime으로 Core 시작, stdout 한 줄 준비 계약 수신, 정상·강제 종료
- `src/client-bootstrap.ts`: protocol·버전·health 검증, NetworkRuntime 후보 교체, 실패 시 기존 Core 유지
- `src/client-process.ts`: `npm start` 사용자 진입점, Core 활성화, 일회용 Browser 세션 생성, 기본 Browser 실행과 종료 대기
- `demo/client-core-loopback-bootstrap-demo.ts`: 실제 자식 프로세스, HTTP/SSE 접속, 롤백과 잔류 프로세스 0개 확인

개발용 `npm start`는 시스템 Node를 사용한다. 포터블 ZIP은 공식 checksum을 검증한 Node 24.18.0 LTS를 포함하며 `process.execPath`로 같은 runtime의 Core를 시작한다. 현재 MVP 클라이언트 UI는 Windows PowerShell WinForms이며, 단일 네이티브 `GongpilClient.exe`와 내장 WebView 전환은 후속 작업이다.
