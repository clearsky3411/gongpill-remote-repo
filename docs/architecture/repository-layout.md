# Repository Layout

상태: `CURRENT`

## 기준

`G:\novel\mu-wiki\codex`는 여러 프로젝트를 담는 상위 작업 폴더다. 공필의 저장소 루트는 `G:\novel\mu-wiki\codex\gongpil`이다.

공필 저장소 안에서 제품 영역은 최상위 폴더로 분리한다.

```text
gongpil/
├─ client/
├─ core/
├─ browser/
├─ installer/
├─ platform/
├─ packages/
├─ builtin-plugins/
├─ docs/
├─ scripts/
├─ templates/
├─ tests/
└─ distribution/
```

## 제품 경계

| 영역 | 소유하는 것 | 소유하지 않는 것 |
|---|---|---|
| Client | 실행 모드, 기준 경로, 런타임, 프로세스·창 수명 | 사용자 문서 의미, UI 작업 상태 |
| Core | 데이터, revision, 권한, 변경 승인, 감사 | 운영체제 창, 사용자 화면 표현 |
| Browser | UI, 탐색, 표시, 사용자 입력 | 절대 경로, 원본 직접 저장, 권한 최종 판정 |
| Installer | 배포, 설치, 제거 선택지, 패키지 검증 | 실행 중 프로젝트 데이터 처리 |
| Platform | 실행 추적, 플러그인 격리, 업데이트 기반 | 제품별 사용자 기능 |
| Packages | 버전 있는 공통 계약과 도메인 로직 | 프로세스 수명과 UI 조합 |
| Built-in Plugins | Markdown, 검색, 지도 등 사용자 작업 기능 | Core 권한 우회와 원본 직접 쓰기 |

## 구조 변경 규칙

1. 새 영역이나 기능을 만들기 전에 `component-registry.json`에 등록한다.
2. 기능은 정확히 하나의 owner component를 가진다.
3. 공유가 필요하다는 이유만으로 구현을 즉시 `packages/`로 이동하지 않는다.
4. 경계가 바뀌면 Code Map, 관련 README, 테스트 위치를 함께 갱신한다.
5. 미구현 폴더는 `TARGET`으로 표시하고 구현된 것처럼 설명하지 않는다.
