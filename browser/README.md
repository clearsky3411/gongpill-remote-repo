# Browser

상태: `CURRENT` (프로젝트·문서 작업 화면 MVP)

Browser는 WebView와 개발용 웹 브라우저에서 사용하는 공통 사용자 인터페이스다.

## 책임

- 프로젝트 선택과 작업 패널
- 문서 탐색, 검색, 채팅과 컨텍스트 표시
- 변경 제안과 diff 승인 화면
- 플러그인 UI 호스팅과 공통 대화상자
- 진행 상태, 오류, trace와 로그 진입점 표시
- NetworkRuntime의 연결·재연결·오프라인·실패 상태 표시

## 경계

- 설치 위치와 사용자 데이터 절대 경로를 알지 않는다.
- 파일 시스템을 직접 읽거나 쓰지 않는다.
- 모든 데이터 작업은 버전 있는 Core API로 요청한다.
- 모든 송신, 최종 결과와 이벤트 수신은 프로세스의 단일 NetworkRuntime 인스턴스를 통한다.
- 기능 코드가 `fetch`, `EventSource`, `WebSocket`이나 주소를 직접 사용하지 않는다.
- UI가 보관하는 상태는 표현 상태이며 사용자 정본이 아니다.
- Core 버전과 업데이트 상태는 표시할 수 있지만 활성 버전을 직접 선택하지 않는다.
- endpoint, token, NetworkConnectionProfile을 전달받거나 저장하지 않는다.

## 현재 구현

- `src/index.html`: 프로젝트, 문서, 편집기와 종료 화면 구조
- `src/styles.css`: 데스크톱·좁은 화면 대응 레이아웃과 상태 표시
- `src/app.js`: 프로젝트·문서 생성/열기, revision 저장, 변경 경고와 종료 흐름
- `platform/network-runtime/browser/network-runtime.js`: same-origin HTTP JSON/SSE 전용 facade

`npm start`로 실제 Core와 함께 기본 Browser에서 열린다. Browser 기능 코드는 파일 시스템과 endpoint를 직접 다루지 않는다.
