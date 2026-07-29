# Client

상태: `CURRENT` (실제 사용자 진입점과 Core 수명 관리)

Client는 인스턴스(브라우저 작업 화면)가 열리기 전에 데이터 위치와 실행 옵션을 정하는 Windows 접속기이자 부트스트랩 프로세스다.

## 책임

- 설치형과 포터블 실행 모드 판정
- 첫 실행·설정 바로가기에서 Runtime 상태, 사용 가능 기능, 패치노트와 데이터 폴더·AI 옵션 제공
- 설치형 `GongpilConfig`, 포터블 `GongpilClient` 설정 검증·원자 저장과 기존 설정 이전
- 96 DPI 기준 DIP, 창 크기, 글자 크기, UI 배율과 UI·고정폭 글꼴 역할을 가진 appearance 설정 v2
- 나눔고딕 Regular/Bold와 D2Coding, 공식 라이선스·SHA-256 manifest를 가진 자기완결 글꼴 카탈로그
- 프로그램·데이터·활성 버전·세션 임시 루트 결정
- 포함 런타임 위치 결정
- Core 프로세스 시작, health check, 종료와 잔류 프로세스 검사
- Client Runtime 상주와 단일 Instance Runtime 정상·비정상 종료 뒤 재시작
- Browser heartbeat ACK 만료 시 Instance Runtime만 정상 종료하고 Client Runtime은 유지
- 후보 Core의 protocol·버전·health 검사 후 활성화 또는 이전 버전 유지
- Core 표준 출력에서 후보 NetworkConnectionProfile 수신
- 단일 NetworkRuntime으로 후보 접속 검증, 활성 교체와 기존 접속 유지
- Windows 접속기와 인스턴스 수명 관리

## 경계

- Client는 사용자 문서를 직접 해석하거나 수정하지 않는다.
- 확정한 경로는 Core에만 전달한다.
- Browser에는 절대 경로와 NetworkConnectionProfile 대신 논리적인 세션 상태만 제공한다.
- API 키 값은 설정 JSON이나 Browser에 전달하지 않고 Core가 외부 환경파일에서 직접 읽게 한다.
- Client 기능은 주소나 HTTP client를 직접 다루지 않고 NetworkRuntime을 사용한다.
- 후보 접속이 ready가 아니면 기존 NetworkRuntime 연결을 유지한다.
- 실행 중인 Core 파일을 덮어쓰지 않고 버전 폴더를 나란히 유지한다.
- 활성 버전 포인터는 후보 Core 검증 뒤에만 전환한다.

## 현재 구현

- `src/bootstrap-paths.ts`: 설치형·포터블 app/data/version/session/runtime 경로 결정
- `src/client-settings-store.ts`: 설치형·포터블 설정 v2와 appearance 기본값, 경로·쓰기 가능성 검증, v1 마이그레이션과 원자 저장
- `src/client-font-catalog.ts`: 번들 글꼴·라이선스 manifest와 checksum 검증, 사용자 글꼴 폴더의 안전한 파일 열거
- `resources/fonts/`: 나눔고딕 Regular/Bold, D2Coding과 배포 라이선스
- `src/client-connector.ts`: Node 프로세스와 Windows 접속기 UI의 JSON 교환·수명 관리
- `src/client-release-notes.json`: Client Package 버전, 현재 가능 기능과 패치노트 정본
- `windows/GongpilConnector.ps1`: 홈·설정·정보, 폴더 선택과 인스턴스 시작 WinForms UI
- `src/core-process-manager.ts`: 지정된 runtime으로 Core 시작, stdout 한 줄 준비 계약 수신, 정상·강제 종료
- `src/client-bootstrap.ts`: protocol·버전·health 검증, NetworkRuntime 후보 교체, 실패 시 기존 Core 유지
- `src/client-runtime.ts`: 장기 실행 Client Runtime 상태와 Instance Runtime 시작·종료·재시작 경계
- `src/client-process.ts`: `npm start` 사용자 진입점, 접속기 반복 표시, 새 세션 생성, 기본 Browser 실행과 Client 최종 종료
- `demo/client-core-loopback-bootstrap-demo.ts`: 실제 자식 프로세스, HTTP/SSE 접속, 롤백과 잔류 프로세스 0개 확인

개발용 `npm start`는 시스템 Node를 사용한다. 포터블 ZIP은 공식 checksum을 검증한 Node 24.18.0 LTS와 Client Package 전용 글꼴을 포함하며 `process.execPath`로 같은 runtime의 Core를 시작한다. 포터블 프로젝트 데이터는 `GongpilData`, Client 설정과 사용자 글꼴은 `GongpilClient`에 분리되고 이전 `GongpilData/client-settings.json`은 검증 후 이동한다. WinForms 접속기는 시스템 글꼴 설치 없이 나눔고딕을 비공개 로드하고 `화면` 탭에서 UI·고정폭 글꼴, 사용자 글꼴 폴더, 96 DPI 기준 DIP 크기, 글자 크기와 UI 배율을 저장한다. 실제 화면보다 큰 설정은 스크롤 가능한 작업 영역으로 제한한다. 일반 실행에서는 `인스턴스 종료` 뒤 Client Runtime 홈이 다시 나타나 같은 데이터 설정으로 새 Instance Runtime을 만들 수 있다. Browser 창을 닫아 heartbeat ACK가 3회 연속 누락돼도 Instance Runtime만 정상 종료하고 홈으로 돌아온다. 항상 표시되는 네이티브 창·트레이, 내장 WebView, 여러 Instance Runtime 동시 관리는 후속 작업이다.
