# 공필(Gongpil) 마스터 컨텍스트 및 전체 개발 체크리스트

> 문서 상태: 신규 Codex 작업공간 이관용 기준 문서  
> 작성 기준일: 2026-07-27  
> 언어: 한국어  
> 목적: 이 문서 하나를 새 Codex 프로젝트에 전달하여 공필의 목적, 확정된 원칙, 목표 구조, 작업 순서, 완료 조건을 복원한다.

---

# 0. 새 Codex 작업공간에 전달할 최상위 지시

아래 지시는 이 문서 전체를 읽는 Codex가 가장 먼저 따라야 한다.

## 0.1 역할

너는 `공필(Gongpil)`이라는 로컬 우선 페어 작가·위키 플랫폼을 함께 설계하고 구현하는 개발 파트너다.

공필은 단순 Markdown 편집기나 채팅 UI가 아니다. 사용자가 소유한 문서·이미지·설정 자료를 정본으로 유지하면서, 사람과 AI가 필요한 정보만 검색하고 청크 단위로 조립하여 논의하고, 변경안을 검토한 뒤 승인된 수정만 원본에 반영하는 자기완결형 작업 플랫폼이다.

## 0.2 가장 중요한 작업 원칙

- 이 문서를 현재 프로젝트의 상위 설계 기준으로 사용한다.
- 코드부터 대량 생성하지 않는다.
- 현재 저장소와 기존 구현을 먼저 조사한 뒤 `현재 상태`, `재사용 가능`, `교체 필요`, `미구현`으로 분류한다.
- 확정 사항과 제안 사항을 섞지 않는다.
- 사용자가 확정하지 않은 선택을 조용히 확정하지 않는다.
- 기존 사용자 원본 문서를 공필 전용 형식으로 강제 이관하지 않는다.
- 변경은 작고 검증 가능한 단위로 수행한다.
- 각 단계마다 완료 조건과 회귀 테스트를 확인한다.
- 위험한 파일 삭제, 데이터 마이그레이션, 자동 원본 수정은 미리 대상과 복구 방법을 명시한다.
- 시스템 전역 환경을 변경하지 않는다.
- 공필의 플러그인과 Codex/ChatGPT 플러그인을 혼동하지 않는다.
- 무협 작품의 개별 설정은 공필 플랫폼 설계와 분리한다.

## 0.3 설계 우선순위

중요도는 다음과 같다.

1. 사용자 원본과 데이터 안전
2. 설치·실행·삭제의 자기완결성
3. 코어와 플러그인의 명확한 책임 경계
4. 변경 제안·승인·리비전 충돌 검사
5. 관찰 가능한 실행 흐름과 복구 가능성
6. 개발 중 기능 교체와 플러그인 확장성
7. 검색·청크·컨텍스트 조립 성능
8. UI 편의성과 시각적 완성도

성능은 중요하지만, 불필요한 조기 최적화 때문에 데이터 안전이나 구조적 명료성을 희생하지 않는다. 반대로 큰 문서 집합, 6K 이상 이미지, 수많은 청크와 장기 채팅을 전제로 데이터 배치·증분 처리·캐시 재생성 가능성을 처음부터 고려한다.

## 0.4 작업 시작 시 반드시 할 일

- [ ] 저장소 루트의 `AGENTS.md`, README, 설계 문서, 패키지 매니페스트를 읽는다.
- [ ] 현재 브랜치와 작업 트리 변경 사항을 확인한다.
- [ ] 기존 파일을 임의로 되돌리거나 덮어쓰지 않는다.
- [ ] 현재 실행 방법과 테스트 방법을 확인한다.
- [ ] 기존 v0.2.0 프로토타입과 목표 구조의 차이를 표로 만든다.
- [ ] 다음 구현 단위를 하나만 선택한다.
- [ ] 구현 전에 해당 단위의 입력·출력·오류·취소·로그·테스트 조건을 적는다.
- [ ] 구현 후 테스트 결과와 남은 위험을 기록한다.

---

# 1. 프로젝트의 정체성

## 1.1 한 문장 정의

> 공필은 사용자가 소유한 로컬 문서와 자산을 정본으로 유지하면서, 검색·청크·컨텍스트·채팅·수정 제안·승인·플러그인을 통해 사람과 AI가 장기 프로젝트를 함께 작성하고 관리하는 자기완결형 로컬 우선 플랫폼이다.

## 1.2 해결하려는 문제

장기 창작 프로젝트에는 다음 문제가 있다.

- 설정이 여러 문서와 대화에 흩어진다.
- AI에게 전체 자료를 매번 줄 수 없다.
- 요약 기억은 원본과 다르며 오염될 수 있다.
- 최신 설정, 폐기 설정, 추론, 이미지 프롬프트가 섞이기 쉽다.
- AI가 원본을 즉시 수정하면 실수와 충돌을 통제하기 어렵다.
- 특정 서비스나 데이터베이스에 자료를 가두면 이동성과 소유권이 약해진다.
- 채팅이 길어질수록 어떤 자료를 근거로 답했는지 추적하기 어렵다.
- 기능을 계속 붙이면 하나의 거대한 애플리케이션이 되어 수정과 삭제가 어려워진다.

공필은 이를 다음 흐름으로 해결한다.

```text
원본 유지
→ 증분 색인
→ 필요한 청크 검색
→ 작업 프로필에 맞는 컨텍스트 조립
→ 사람과 AI의 논의
→ 변경 제안 생성
→ diff와 근거 확인
→ 사용자 승인
→ 리비전 검사 후 반영
→ 이력·색인 갱신
```

## 1.3 공필이 아닌 것

- 특정 무협 세계관 전용 프로그램이 아니다.
- AI가 임의로 파일 전체를 재작성하는 자동 집필기가 아니다.
- 문서를 반드시 전용 데이터베이스에 넣어야 하는 폐쇄형 위키가 아니다.
- 시스템 전역 Node.js나 Python 환경을 관리하는 개발 도구가 아니다.
- 모든 기능을 코어에 정적으로 포함한 단일 거대 앱이 아니다.
- 제3자 플러그인을 완전히 신뢰하는 보안 샌드박스가 초기 목표인 것은 아니다.
- Git을 사용자 데이터 저장의 필수 조건으로 강제하지 않는다.

---

# 2. 정본과 의사결정 규칙

## 2.1 정보 우선순위

충돌 시 다음 순서로 판단한다.

1. 사용자가 현재 대화에서 명시적으로 확정한 내용
2. 이 마스터 문서의 `확정` 항목
3. 저장소 안의 최신 승인 설계 문서
4. 실제 코드와 테스트가 보여주는 현재 구현
5. 과거 대화 요약과 기억
6. 추론 또는 새 제안

과거 대화 요약은 참고 자료이며 정본이 아니다.

## 2.2 상태 라벨

설계 문서와 이슈에는 다음 라벨을 사용한다.

| 라벨 | 의미 |
|---|---|
| `CONFIRMED` | 사용자가 확정한 기준 |
| `CURRENT` | 현재 구현이 실제로 동작하는 상태 |
| `TARGET` | 확정된 목표지만 아직 미구현 |
| `PROPOSED` | 검토할 제안 |
| `TBD` | 결정 필요 |
| `DEFERRED` | 현재 버전에서 의도적으로 연기 |
| `LEGACY` | 기존 구현 호환 또는 제거 예정 |
| `REJECTED` | 폐기된 선택 |

## 2.3 기존 결정의 충돌 해소

과거에는 “코어가 모든 기능을 담되 UI는 만들지 않는다”는 표현이 있었다. 최신 기준은 다음과 같이 해석한다.

- 코어는 모든 **플랫폼 권한과 데이터 소유 기능**의 최종 집행자다.
- 플러그인은 모든 **사용자 작업 기능과 표현 방식**을 구현한다.
- 플러그인은 코어를 우회해 원본을 직접 수정할 수 없다.
- 기본 제공 기능도 일반 플러그인과 같은 규격을 사용한다.

따라서 최신 정본은 `최소 플랫폼 코어 + 기본 플러그인 + 사용자 플러그인`이다.

---

# 3. 절대 제약: 자기완결형 배포

## 3.1 설치 격리

- [ ] Node.js 런타임은 공필 프로그램 폴더에 포함한다.
- [ ] 코어, 웹 UI, 클라이언트, 플러그인 호스트를 공필 소유 경로에 둔다.
- [ ] 시스템 Node.js, npm, pnpm, Python 설치 여부에 의존하지 않는다.
- [ ] 전역 npm 패키지를 설치하지 않는다.
- [ ] 시스템 `PATH`를 수정하지 않는다.
- [ ] 시스템 전역 `CODEX_HOME`을 생성하거나 변경하지 않는다.
- [ ] 시스템 서비스를 등록하지 않는다.
- [ ] 고정 포트를 전제로 하지 않는다.
- [ ] 영구 방화벽 규칙을 기본 생성하지 않는다.
- [ ] 파일 연결, 시작 프로그램, 바탕화면 바로가기는 선택 사항으로 둔다.
- [ ] 레지스트리는 제거 프로그램 등록 등 Windows가 요구하는 최소 범위만 사용한다.
- [ ] WebView2는 기존 런타임 사용을 우선하고, 필요할 때만 독립형 포함 또는 안내한다.

## 3.2 실행 격리

모든 하위 프로세스 환경은 런처가 실행 시점에 전달한다.

```text
GONGPIL_APP_ROOT=<프로그램 루트>
GONGPIL_DATA_ROOT=<사용자 데이터 루트>
GONGPIL_VERSION_ROOT=<활성 버전 루트>
GONGPIL_SESSION_TEMP=<세션 임시 루트>
CODEX_HOME=<공필이 실행한 Codex 프로세스 전용 경로>
```

이 값은 공필 프로세스 트리 안에서만 존재해야 한다.

- [ ] 부모 시스템 환경을 영구 변경하지 않는다.
- [ ] 하위 프로세스가 사용할 환경을 명시적으로 구성한다.
- [ ] 종료 시 공필이 생성한 자식 프로세스를 정리한다.
- [ ] 사용자 개인 Codex 환경과 공필 전용 Codex 환경을 분리한다.
- [ ] 세션 임시 경로는 세션 ID별로 생성한다.
- [ ] 비정상 종료 뒤 잔류 세션을 다음 실행에서 탐지한다.

## 3.3 데이터 격리

프로그램과 사용자 데이터는 별도 루트다.

```text
Gongpil/
├─ GongpilClient.exe
├─ runtime/
├─ versions/
├─ plugin-host/
├─ plugins/
├─ config/
└─ temp/

GongpilData/
├─ projects/
├─ chats/
├─ personas/
├─ memory/
├─ database/
├─ settings/
├─ logs/
├─ cache/
├─ plugin-data/
└─ integrations/
```

연결은 프로그램 로컬 설정의 `dataRoot` 하나로 한다.

```json
{
  "dataRoot": "D:/GongpilData"
}
```

## 3.4 삭제 격리

제거 선택지는 명확히 나눈다.

1. 프로그램만 제거
2. 프로그램 + 캐시·로그 제거
3. 프로그램 + 모든 공필 소유 데이터 제거

기본값은 사용자 원본 보존이다.

- [ ] 삭제 전 실제 대상 경로를 표시한다.
- [ ] 삭제 전 예상 용량을 표시한다.
- [ ] 외부 연결 프로젝트 원본은 완전 삭제에서도 자동 제거하지 않는다.
- [ ] 플러그인 제거가 프로젝트 원본 자산을 지우지 않게 한다.
- [ ] 생성한 바로가기와 최소 레지스트리 항목만 정확히 제거한다.
- [ ] 운영체제 자체의 최근 실행 기록 등을 공필이 억지로 삭제하지 않는다.

## 3.5 포터블 모드

```text
GongpilPortable/
├─ portable.marker
├─ GongpilClient.exe
├─ app/
├─ runtime/
├─ plugins/
└─ GongpilData/
```

- [x] `portable.marker`가 있으면 데이터 루트를 무조건 `./GongpilData`로 사용한다.
- [x] AppData, PATH, 레지스트리에 공필 설정을 쓰지 않는다.
- [x] ZIP 해제 → 실행 → 폴더 삭제로 사용을 끝낼 수 있다.
- [x] 포터블과 설치형의 프로젝트 형식은 동일하다.

현재 MVP는 단일 `GongpilClient.exe` 대신 `Gongpil.vbs` → 포함 Node → WinForms 접속기를 사용한다. 네이티브 exe 통합은 후속 작업이다.

---

# 4. 최종 제품 계층

```text
공필 플랫폼
├─ Launcher / Desktop Client
├─ Core
├─ Shell Web UI
├─ Execution & Observability
├─ Plugin Platform
│  ├─ Plugin Host
│  ├─ Plugin Runtime
│  ├─ Plugin SDK
│  └─ Plugin Manager
├─ Built-in Plugins
├─ User Plugins
├─ Installer / Updater / Uninstaller
└─ Developer Tooling
```

## 4.1 구성요소 책임

| 구성요소 | 기본 기술 | 책임 |
|---|---|---|
| Launcher | Tauri 2 + 최소 Rust | 루트 탐색, 포함 런타임 실행, 프로세스 수명, 창, 업데이트 전환 |
| Core | TypeScript + 포함 Node.js | 프로젝트·문서·자산·채팅·권한·패치·플러그인·이벤트의 최종 집행 |
| Shell Web UI | React + TypeScript | 창, 패널, 메뉴, 라우팅, 공통 대화상자 |
| Execution | TypeScript | feature dispatch, trace, scope, 취소, 로그 |
| Plugin Host | TypeScript + Node.js | 플러그인별 프로세스 실행·감시·종료 |
| Plugin UI Host | sandboxed iframe | UI 격리와 메시지 브리지 |
| Plugin SDK | TypeScript | 버전 있는 공필 API |
| Installer | Inno Setup 후보 | 자기완결 설치·삭제 |
| Package Builder | TypeScript | 버전·플러그인 패키지 생성, 검증, 해시 |

기술 선택은 현재 목표안이다. 기존 저장소와 실험 결과를 조사한 뒤 바꿀 수 있지만, 바꿀 경우 자기완결성·격리·개발 편의에 미치는 영향을 먼저 기록한다.

---

# 5. 코어와 플러그인의 경계

## 5.1 코어가 반드시 소유하는 것

- [ ] 프로그램 시작·종료
- [ ] 데이터 루트 확인
- [ ] 프로젝트 열기·닫기
- [ ] 프로젝트와 파일의 안정적인 ID
- [ ] 문서 원본 읽기·쓰기
- [ ] 문서 revision과 충돌 검사
- [ ] 자산 등록과 메타데이터
- [ ] 채팅 원본 저장
- [ ] 페르소나와 작업 프로필 원본 저장
- [ ] 변경 제안, diff, 승인, 적용
- [ ] 권한 결정과 집행
- [ ] 플러그인 설치·활성화·비활성화·삭제
- [ ] 이벤트 버스
- [ ] 실행 scope와 trace
- [ ] 작업 취소
- [ ] 감사 로그
- [ ] 백업·복구
- [ ] 버전·호환성 검사
- [ ] 파생 데이터 재생성

## 5.2 플러그인으로 구현할 것

- [ ] Markdown 편집기
- [ ] 문서 미리보기
- [ ] 전문 검색 UI와 고급 검색기
- [ ] 지도 뷰어
- [ ] 관계도
- [ ] 타임라인
- [ ] 인물 카드
- [ ] 설정 충돌 탐지기
- [ ] 무공 계산기
- [ ] 문서 분석기
- [ ] 외부 AI 공급자 통합
- [ ] Git 연동
- [ ] 내보내기와 특수 포맷
- [ ] 테마와 레이아웃 프리셋

## 5.3 경계 검증 질문

기능을 추가할 때마다 묻는다.

- [ ] 이 기능이 없으면 사용자 원본의 안전이 깨지는가? 그렇다면 코어 후보.
- [ ] 이 기능은 같은 원본을 다른 방식으로 보여주는가? 그렇다면 플러그인 후보.
- [ ] 이 기능이 특정 작업 분야나 형식에 종속되는가? 그렇다면 플러그인 후보.
- [ ] 이 기능이 권한을 최종 집행하는가? 그렇다면 코어.
- [ ] 플러그인을 제거해도 원본을 계속 열고 복구할 수 있는가?
- [ ] 코어 API를 우회하는 직접 파일 접근이 생기지 않는가?

---

# 6. 프로그램 및 데이터 디렉터리

## 6.1 설치형 프로그램 영역

```text
Gongpil/
├─ GongpilClient.exe
├─ runtime/
│  ├─ node/
│  └─ webview-support/
├─ versions/
│  ├─ 0.1.0/
│  │  ├─ core/
│  │  └─ web/
│  └─ active.json
├─ plugin-host/
├─ plugins/
│  └─ <plugin-id>/
│     ├─ <version>/
│     └─ active.json
├─ config/
│  └─ machine.json
└─ temp/
```

## 6.2 사용자 데이터 영역

```text
GongpilData/
├─ projects/
├─ chats/
├─ personas/
├─ memory/
├─ database/
├─ settings/
├─ logs/
├─ cache/
├─ plugin-data/
│  └─ <plugin-id>/
│     ├─ global/
│     ├─ cache/
│     └─ settings.json
└─ integrations/
   └─ codex/
```

## 6.3 프로젝트 내부

기존 사용자 폴더를 그대로 프로젝트로 연결할 수 있어야 한다.

```text
MuWiki/
├─ wiki.project.json
├─ documents/
├─ assets/
├─ profiles/
├─ references/
└─ .gongpil/
   ├─ index/
   ├─ history/
   ├─ runtime/
   ├─ proposals/
   ├─ metadata/
   └─ plugins/
      └─ <plugin-id>/
         ├─ data/
         └─ project-settings.json
```

사용자에게 이미 폴더 구조가 있다면 `documents/` 등으로 강제 이동하지 않는다. 위 구조는 공필이 새 프로젝트를 만들 때의 기본안이며, 기존 폴더 연결 시 매핑을 허용한다.

## 6.4 데이터 분류

| 분류 | 예 | 삭제/재생성 정책 |
|---|---|---|
| 사용자 정본 | Markdown, JSON, 이미지, 초고 | 자동 삭제 금지 |
| 공필 정본 | 채팅 턴, 페르소나, 승인 기록 | 백업 후 명시적 삭제 |
| 파생 데이터 | 전문 색인, 썸네일, 타일 캐시 | 재생성 가능 |
| 세션 데이터 | 포트, PID, 임시 IPC 토큰 | 종료 시 제거 |
| 플러그인 프로그램 | backend/UI bundle | 버전 단위 제거 |
| 플러그인 전용 데이터 | 설정, 캐시 | 제거 옵션 분리 |

---

# 7. 프로젝트 모델과 원본 보존

## 7.1 프로젝트 열기

- [ ] 새 프로젝트 생성
- [ ] 기존 폴더 연결
- [ ] 읽기 전용 프로젝트 열기
- [ ] 프로젝트 ID 생성
- [ ] 프로젝트 루트 canonical path 확인
- [ ] 중복 프로젝트 연결 탐지
- [ ] 쓰기 가능 여부 확인
- [ ] 잠금 파일 또는 동시 실행 정책 적용
- [ ] 손상된 `.gongpil` 파생 데이터 무시 후 재생성
- [ ] 프로젝트 닫기 시 watcher, lock, worker 정리

## 7.2 파일 신원

파일 경로만 ID로 쓰지 않는다. 이름 변경과 이동을 추적할 수 있어야 한다.

권장 개념:

```ts
type FileId = string;

interface SourceAddress {
  fileId: FileId;
  revision: number;
  range?: SourceRange;
}
```

- [ ] `fileId` 생성 규칙 정의
- [ ] 경로 변경 시 동일 파일 추적 방법 정의
- [ ] 내용 해시와 ID 역할 분리
- [ ] 대소문자 비구분 Windows 경로 처리
- [ ] 심볼릭 링크·junction 정책 정의
- [ ] 외부 루트 탈출 방지

## 7.3 Revision

- [ ] 모든 쓰기 가능한 원본에 revision을 둔다.
- [ ] 읽을 때 snapshot revision을 함께 반환한다.
- [ ] 변경안은 기준 revision을 반드시 포함한다.
- [ ] 적용 직전 현재 revision과 다시 비교한다.
- [ ] 불일치 시 `REVISION_CONFLICT`를 반환한다.
- [ ] 충돌 시 자동 덮어쓰지 않는다.
- [ ] 재기반(rebase) 가능한 패치와 불가능한 패치를 구분한다.

## 7.4 원자적 저장

- [ ] 같은 볼륨 임시 파일에 새 내용을 쓴다.
- [ ] flush와 rename/replace 정책을 운영체제별로 검증한다.
- [ ] 저장 전 이전 버전 복구 지점을 만든다.
- [ ] 중간 실패 시 원본 또는 새 버전 중 하나가 온전히 남게 한다.
- [ ] 디스크 공간 부족을 명시적 오류로 처리한다.
- [ ] 인코딩과 줄바꿈 보존 정책을 정의한다.

---

# 8. 청크, 좌표, 색인

## 8.1 목적

전체 파일을 매번 AI에게 보내지 않고 필요한 범위만 안정적으로 찾고 인용하고 수정하기 위한 계층이다.

## 8.2 좌표 모델

기존 아이디어는 다음을 포함한다.

- 문서의 의미 ID
- 파일 ID
- revision
- 시작/끝 범위
- 줄·문자 좌표
- 사람이 복사할 수 있는 표현
- 기계가 빠르게 찾는 숫자 표현

예시 표현:

```text
sigma-(FCA0,005)~(FCA3,120)
```

하지만 4자리 16진수 줄/문자 제한, UTF-8 바이트와 Unicode 문자 단위, 큰 파일 범위를 정식으로 결정해야 한다.

### 결정 체크리스트

- [ ] 내부 좌표는 byte offset, Unicode code point, UTF-16 code unit 중 무엇인지 확정
- [ ] UI 표시 좌표와 내부 저장 좌표 분리 여부 확정
- [ ] 한글·한자·이모지·결합 문자 테스트
- [ ] CRLF/LF 변환 시 좌표 안정성 정의
- [ ] revision이 다르면 좌표를 어떻게 취급할지 정의
- [ ] 파일 전체 해시와 청크 해시 사용 여부 확정
- [ ] 4자리 16진수 표기는 표시 전용인지 확정
- [ ] 매우 긴 줄과 65,535줄 초과 파일 처리

권장 방향은 내부적으로 충분한 폭의 정수 byte offset과 revision을 사용하고, 줄/문자·16진수 표기는 사람이 보는 파생 표현으로 두는 것이다. 아직 사용자 최종 확정이 필요한 항목이다.

## 8.3 청크 모델

```ts
interface ChunkDescriptor {
  chunkId: string;
  fileId: string;
  revision: number;
  range: SourceRange;
  headingPath?: string[];
  tags?: string[];
  summary?: string;
  contentHash: string;
}
```

- [ ] Markdown heading 기반 청크
- [ ] JSON 구조 기반 청크
- [ ] 일반 텍스트 문단 기반 청크
- [ ] 코드 파일 symbol 기반 청크
- [ ] 이미지 메타데이터 청크
- [ ] 너무 큰 청크의 하위 분할
- [ ] 너무 작은 청크의 묶음
- [ ] head/global/tail 선택
- [ ] 참조 목록과 역참조
- [ ] 토큰 수·문자 수 추정

## 8.4 색인

- [ ] 파일 watcher 이벤트 수집
- [ ] debounce와 이벤트 병합
- [ ] 변경 파일만 증분 재색인
- [ ] rename 추적
- [ ] 삭제 tombstone 처리
- [ ] 파서 실패 파일 격리
- [ ] 색인 버전과 스키마 버전
- [ ] 전체 재색인
- [ ] 중단된 색인 재개
- [ ] 색인 상태 UI
- [ ] 원본과 색인 불일치 검사

색인은 정본이 아니며 언제든 원본에서 재생성 가능해야 한다.

---

# 9. 검색과 컨텍스트 조립

## 9.1 검색 종류

- [ ] 파일명 검색
- [ ] 제목/heading 검색
- [ ] 전문 검색
- [ ] 태그 검색
- [ ] 문서 종류 검색
- [ ] ID 직접 검색
- [ ] 참조/역참조 검색
- [ ] 최근 변경 검색
- [ ] 의미 검색은 후속 단계

## 9.2 컨텍스트 조립

작업 프로필은 어떤 전역 정보와 문서 계층을 우선할지 정한다.

```text
검색 결과
→ 사용자가 청크 선택
→ 필수 전역 규칙 주입
→ 참조된 최소 청크 추가
→ 토큰 예산 계산
→ 중복 제거
→ 출처와 revision 포함
→ AI 요청 컨텍스트 생성
```

- [ ] 선택 청크를 사용자가 확인할 수 있다.
- [ ] 자동 추가된 청크를 구분한다.
- [ ] 각 청크의 파일, 범위, revision을 표시한다.
- [ ] 잘린 청크를 표시한다.
- [ ] 토큰 예산 초과 시 조용히 누락하지 않는다.
- [ ] 정본, 참고, 폐기, 추론 등 정보 등급을 표현한다.
- [ ] 서로 다른 프로젝트의 컨텍스트가 섞이지 않게 한다.

---

# 10. 채팅, 브랜치, 페르소나, 기억

## 10.1 채팅 저장 구조

기존 결정:

```text
chats/
└─ <chat-format-version>/
   └─ <persona-id>/
      └─ <chat-id>/
         └─ <branch-id>/
            ├─ branch.json
            └─ turns/
               ├─ 000001.json
               ├─ 000002.json
               └─ ...
```

채팅은 턴 단위 JSON으로 저장하고, 브랜치·복사·이전 대화 재개가 가능해야 한다.

## 10.2 채팅 체크리스트

- [ ] chat ID와 branch ID 생성
- [ ] parent branch와 fork turn 기록
- [ ] 턴 순서와 안정적인 turn ID
- [ ] 사용자, assistant, tool, system 역할 표현
- [ ] 텍스트·파일·이미지·도구 결과 참조
- [ ] 컨텍스트에 실제로 포함한 청크 snapshot 기록
- [ ] 모델·공급자·요청 옵션 기록 범위
- [ ] streaming 중 중단된 턴 처리
- [ ] 재시도와 대체 응답 처리
- [ ] 브랜치 생성
- [ ] 브랜치 복사
- [ ] 보관·삭제·복구
- [ ] 포맷 버전 마이그레이션

## 10.3 페르소나

페르소나는 말투만이 아니라 작업 태도, 참고 우선순위, 금지 사항, 품질 기준을 포함한다.

- [ ] persona ID와 버전
- [ ] 시스템 지시
- [ ] 작업 방식
- [ ] 문체와 금지 표현
- [ ] 참조 우선순위
- [ ] 기본 작업 프로필
- [ ] 프로젝트 전용 override
- [ ] 페르소나 변경 시 기존 채팅 의미 보존
- [ ] UI에서 프로필/페르소나 전환

## 10.4 장기 기억

- [ ] 기억은 원본 설정과 분리한다.
- [ ] 기억이 어느 근거에서 만들어졌는지 기록한다.
- [ ] 사실, 선호, 요약, 추론을 구분한다.
- [ ] 사용자가 수정·비활성화·삭제할 수 있다.
- [ ] 프로젝트별 기억과 일반 기억을 분리한다.
- [ ] 오래된 기억이 최신 원본을 덮지 못하게 한다.

---

# 11. 변경 제안과 승인

## 11.1 절대 규칙

> UI의 `변경 저장` 또는 플러그인의 수정 요청은 원본 직접 쓰기가 아니라 변경 제안을 만든다. `변경 확정` 전에는 원본이 바뀌지 않는다.

## 11.2 처리 흐름

```text
변경 제안 생성
→ 대상 fileId/revision 검사
→ patch 형식 검증
→ diff 생성
→ 근거·영향 범위 표시
→ 사용자 승인
→ 적용 직전 revision 재검사
→ 안전한 원자 저장
→ revision 증가
→ 이력 기록
→ 색인 갱신
→ 이벤트 발행
```

## 11.3 체크리스트

- [ ] 문서 전체 교체 패치
- [ ] 정확한 범위 교체 패치
- [ ] 여러 파일 묶음 패치
- [ ] 생성·이름 변경·이동 제안
- [ ] 예상 revision 포함
- [ ] diff 미리보기
- [ ] 변경 이유와 근거
- [ ] 부분 승인 정책
- [ ] 승인 전 수정
- [ ] 거절과 보관
- [ ] 만료된 제안 처리
- [ ] 충돌 재기반
- [ ] 원복 제안 생성
- [ ] 적용 뒤 재읽기 검증

## 11.4 승인 정책

초기 기본값은 사람이 승인한다.

- [ ] 자동 승인 가능한 안전 범위를 별도 정의
- [ ] 플러그인별 승인 정책
- [ ] 프로젝트별 승인 정책
- [ ] 파일 종류별 승인 정책
- [ ] 여러 파일 삭제는 항상 명시 승인
- [ ] 외부 연결 원본 변경은 강한 경고

---

# 12. 실행 모델: Feature, Flow, Scope, Trace

사용자는 작은 작업도 고립된 단발 호출로 보기보다 메인 흐름 안에서 시작과 끝을 가진 작업으로 보길 원한다.

## 12.1 개념

| 개념 | 의미 |
|---|---|
| Flow | 사용자 행동에서 이어지는 전체 작업 흐름 |
| Feature | 호출 가능한 명시적 기능 진입점 |
| Scope | 기능 실행 한 번의 시작·끝·상태 |
| Trace | 프로세스와 플러그인 경계를 잇는 전체 추적 |
| Barrier | 스레드·프로세스·비동기 경계의 명시적 동기화 지점 |

## 12.2 이벤트

```json
{
  "event": "scope.started",
  "traceId": "trace-...",
  "scopeId": "scope-...",
  "parentScopeId": "scope-parent-...",
  "featureId": "map.marker.create",
  "pluginId": "org.gongpil.map-viewer",
  "pluginVersion": "1.0.0",
  "timestamp": "...",
  "processId": 18240
}
```

필수 이벤트 후보:

- `flow.started`
- `flow.completed`
- `flow.failed`
- `scope.started`
- `scope.progress`
- `scope.completed`
- `scope.failed`
- `scope.cancel.requested`
- `scope.cancelled`
- `barrier.entered`
- `barrier.released`

## 12.3 구현 체크리스트

- [ ] `defineFeature()` 계약
- [ ] `FeatureDispatcher`
- [ ] 입력 스키마 검증
- [ ] 출력 스키마 검증
- [ ] traceId/scopeId 생성
- [ ] parent-child scope 연결
- [ ] async context 전달
- [ ] 프로세스 경계 trace 전달
- [ ] 플러그인 경계 trace 전달
- [ ] 취소 토큰 전달
- [ ] timeout
- [ ] 진행률
- [ ] JSONL 구조 로그
- [ ] 민감 데이터 redaction
- [ ] 비정상 종료 scope 복구 표시
- [ ] 흐름 시각화용 조회 API

---

# 13. 플러그인 플랫폼

## 13.1 원칙

공필 플러그인은 독립적으로 설치·업데이트·비활성화·삭제되는 공필 자체 확장 규격이다.

- 프로그램 파일 분리
- 프로세스 분리
- UI 분리
- 데이터 분리
- 권한 분리
- 버전 분리
- 장애 분리

## 13.2 플러그인 종류

| 종류 | 예 | 실행 |
|---|---|---|
| UI | 지도, 관계도, 타임라인 | sandboxed iframe |
| 작업 | 색인, 검사, 내보내기 | 별도 Node 프로세스 |
| 통합 | AI, Git, 외부 서버 | 별도 Node 프로세스 |
| 포맷 | Markdown, JSON, 전용 포맷 | 별도 프로세스 |
| 복합 | 지도 UI + 타일 생성 | UI + backend |
| 테마 | 색상, 아이콘, 레이아웃 | 제한된 정적 자원 |

## 13.3 패키지

확장자:

```text
.gongpil-plugin
```

실제 형식은 검증 가능한 ZIP이다.

```text
<plugin-id>-<version>.gongpil-plugin
├─ plugin.json
├─ package.manifest.json
├─ backend/
├─ ui/
├─ schemas/
├─ migrations/
├─ icons/
├─ licenses/
└─ README.md
```

- [ ] 설치 시 `npm install`을 실행하지 않는다.
- [ ] 의존성은 빌드 시 bundle한다.
- [ ] ZIP 경로 탈출을 차단한다.
- [ ] 압축 폭탄 제한을 둔다.
- [ ] 파일 수·해제 크기 제한을 둔다.
- [ ] SHA-256을 검증한다.
- [ ] 서명 정책을 버전별로 정의한다.

## 13.4 Manifest

최소 필드:

- schemaVersion
- id
- name
- version
- publisher
- description
- Gongpil 호환 범위
- Plugin API 호환 범위
- backend/UI entrypoint
- contributes
- permissions
- network policy

`contributes` 후보:

- views
- commands
- menus
- assetTypes
- documentTypes
- settings
- themes
- migrations

플러그인이 공필 DOM에 직접 메뉴를 삽입하지 않는다. 선언을 코어가 읽고 Shell이 표현한다.

## 13.5 Plugin API v1 최소 범위

- [ ] 현재 프로젝트 요약
- [ ] 문서 snapshot 읽기
- [ ] 문서 변경 제안
- [ ] 자산 목록
- [ ] 자산 메타데이터 읽기
- [ ] binary handle 기반 자산 읽기
- [ ] 플러그인 전용 저장소
- [ ] 명령 등록
- [ ] 이벤트 구독
- [ ] 알림
- [ ] 공통 대화상자
- [ ] 취소와 진행률

초기 API에 내부 코어 객체를 그대로 노출하지 않는다. 모든 API는 버전 있는 RPC 계약이다.

## 13.6 권한

권한 후보:

```text
project.documents.read
project.documents.propose-write
project.assets.read
project.assets.create
plugin.data.read
plugin.data.write
chat.read
chat.send
ai.request
network.http
clipboard.read
clipboard.write
process.spawn
```

- [ ] 최소 권한 원칙
- [ ] 설치 전 사람이 이해할 수 있는 설명
- [ ] 새 버전의 권한 증가 시 업데이트 보류
- [ ] 프로젝트별 권한 override
- [ ] 런타임 권한 거부
- [ ] 권한 감사 로그
- [ ] 민감 API는 사용자 동작 시점 재확인

## 13.7 백엔드 격리

```text
GongpilCore
├─ PluginHost: map-viewer
├─ PluginHost: search
└─ PluginHost: ai-provider
```

- [ ] 플러그인별 별도 프로세스
- [ ] heartbeat
- [ ] startup timeout
- [ ] request timeout
- [ ] graceful shutdown
- [ ] 강제 종료 fallback
- [ ] crash 감지
- [ ] 재시작 횟수 제한
- [ ] 메모리·CPU 정책
- [ ] 로그 분리
- [ ] 플러그인 장애가 코어를 종료하지 않음

별도 프로세스는 장애 격리이지 완전한 보안 샌드박스가 아니다. 일반 Node API를 허용하면 파일·프로세스 접근을 막을 수 없다. 초기 신뢰 모델을 명시하고, 불신 코드 실행은 Windows AppContainer 등 별도 단계로 둔다.

## 13.8 UI 격리

- [ ] sandboxed iframe
- [ ] `postMessage` 브리지
- [ ] origin과 session 검증
- [ ] 상위 DOM 직접 접근 금지
- [ ] 임의 팝업 금지
- [ ] 외부 네트워크 기본 금지
- [ ] 클립보드 권한
- [ ] 파일 직접 접근 금지
- [ ] CSP
- [ ] UI crash/reload
- [ ] 테마 토큰 전달
- [ ] 접근성 공통 계약

## 13.9 생명주기

### 설치

- [ ] 패키지 선택
- [ ] 압축 안전성 검사
- [ ] 해시·서명 검사
- [ ] manifest 스키마 검사
- [ ] ID·버전 검사
- [ ] API 호환성 검사
- [ ] 요청 권한 표시
- [ ] 임시 폴더 해제
- [ ] 마이그레이션 사전 검사
- [ ] 버전 폴더로 원자 이동
- [ ] 시험 실행
- [ ] 활성화

### 업데이트

- [ ] 새 버전을 별도 폴더에 설치
- [ ] 기존 데이터 백업
- [ ] migration dry run
- [ ] 새 프로세스 health check
- [ ] `active.json` 원자 전환
- [ ] 기존 버전 종료
- [ ] 실패 시 이전 버전 유지
- [ ] 데이터 migration rollback

### 비활성화

- [ ] 새 호출 차단
- [ ] 진행 작업 취소 요청
- [ ] 제한 시간 대기
- [ ] 프로세스 종료
- [ ] UI 제거
- [ ] 명령·메뉴·이벤트 등록 해제

### 삭제

- [ ] 프로그램만
- [ ] 프로그램 + 캐시
- [ ] 프로그램 + 전용 데이터
- [ ] 프로젝트 원본 유지
- [ ] 실제 삭제 경로 표시
- [ ] 활성 프로세스 없음 확인

---

# 14. 첫 검증 플러그인: 지도 뷰어

첫 실제 검증 자산:

```text
TanmaChinaMap_v15_6000x4000.png
크기: 6000 × 4000
용도: 중국 무림 지리 원본 참고 지도
```

이 지도는 공필 프로그램 설치 영역이 아니라 사용자 프로젝트 자산이다.

## 14.1 목표

- [ ] 대형 이미지 열기
- [ ] 확대·축소
- [ ] 이동
- [ ] fit-to-view
- [ ] 이미지 좌표 표시
- [ ] 레이어
- [ ] 표식
- [ ] 표식 검색
- [ ] 문서 참조
- [ ] 지도와 문서 양방향 이동
- [ ] 경로
- [ ] 시대/타임라인 연동을 위한 확장점
- [ ] 캐시 생성
- [ ] 플러그인 설치·삭제 후 원본 유지

## 14.2 메타데이터

```json
{
  "schemaVersion": 1,
  "assetId": "map-tanma-china-v15",
  "image": "TanmaChinaMap_v15_6000x4000.png",
  "imageSize": {
    "width": 6000,
    "height": 4000
  },
  "coordinateSystem": {
    "type": "image-pixel",
    "origin": "top-left"
  },
  "layers": [
    {
      "id": "canonical",
      "title": "원본 지명",
      "locked": true
    },
    {
      "id": "project",
      "title": "작품 설정",
      "locked": false
    }
  ]
}
```

원본 지도에서 읽은 사실과 작품에서 추가한 설정을 같은 레이어에 섞지 않는다.

## 14.3 표식

```json
{
  "id": "marker-kunlun",
  "layerId": "project",
  "position": {
    "x": 1260,
    "y": 1220
  },
  "title": "곤륜파",
  "documentRef": "faction.kunlun",
  "tags": ["문파", "구파일방"]
}
```

- [ ] 표식을 이미지 픽셀에 굽지 않는다.
- [ ] 표식 데이터는 별도 구조화 파일로 둔다.
- [ ] 원본 레이어는 잠글 수 있다.
- [ ] 프로젝트 레이어는 편집 가능하다.
- [ ] 화면 좌표와 이미지 좌표 변환을 테스트한다.
- [ ] DPI와 zoom 변화에 무관하게 표식이 같은 이미지 지점을 가리킨다.
- [ ] 6K 이미지는 초기에는 원본 렌더링으로 시작한다.
- [ ] 실제 성능 문제가 확인되면 타일 피라미드 캐시를 추가한다.

## 14.4 이 플러그인이 검증하는 플랫폼 기능

- 대형 binary asset API
- iframe UI
- backend worker
- 플러그인 저장소
- 프로젝트 자산 참조
- 명령·메뉴 기여
- 권한
- 캐시
- 설치·업데이트·롤백·삭제
- trace와 scope

---

# 15. 데스크톱 런처와 실행

## 15.1 시작 흐름

```text
GongpilClient.exe
→ portable/install 모드 판정
→ machine.json과 dataRoot 확인
→ active version 검증
→ session temp 생성
→ 포함 Node로 Core 실행
→ Core가 동적 endpoint 개방
→ 세션 인증 정보 전달
→ health check
→ Shell Web 창 열기
→ 기본 플러그인 시작
```

## 15.2 종료 흐름

```text
Instance Runtime 종료 요청
→ 새 작업 차단
→ 진행 중 작업 확인
→ 취소/대기 정책
→ 플러그인 종료
→ Core flush
→ 세션 파일 제거
→ 자식 프로세스 잔류 확인
→ Client Runtime idle
→ 접속기에서 새 Instance Runtime 시작 또는 Client Runtime 종료
→ Client Runtime 종료 시 Launcher 종료
```

현재 구현은 한 번에 하나의 Instance Runtime을 실행하며, 정상·비정상 종료 뒤 상주 Client Runtime이 홈으로 돌아가 새 Instance Runtime을 시작할 수 있다. Client 홈은 Runtime 상태, 현재 가능 기능, 구조화 패치노트와 설정·실행 정보를 구분해 표시한다. Browser는 SSE heartbeat에 ACK하고, 응답이 3회 연속 끊기면 Instance Runtime만 정상 종료한다. 여러 Instance Runtime 동시 실행, 자동 재시작, updater 연동은 후속 목표다.

## 15.3 체크리스트

- [ ] 동적 포트 또는 named pipe 후보 비교
- [ ] 세션별 인증 토큰
- [ ] 다른 로컬 프로세스의 무단 호출 방지
- [ ] Core health check
- [ ] Core crash 화면
- [ ] 로그 열기
- [ ] 안전 모드: 플러그인 없이 시작
- [ ] 이전 crash 감지
- [ ] 중복 실행 정책
- [ ] 여러 창/여러 프로젝트 정책
- [x] 단일 Instance Runtime 종료와 Client Runtime 종료 분리
- [x] Instance Runtime 정상·비정상 종료 뒤 수동 재시작
- [x] Browser heartbeat ACK 만료 시 Instance Runtime 자동 종료와 Client Runtime 생존
- [x] Client 홈의 상태·가능 기능·패치노트와 설정·정보 구분
- [ ] Windows 재부팅·로그오프 처리

---

# 16. Shell Web UI

Shell은 공통 작업공간만 제공한다.

## 16.1 기본 영역

- [ ] 로비/프로젝트 선택
- [ ] 좌측 탐색기
- [ ] 중앙 작업 패널
- [ ] 우측 컨텍스트/정보 패널
- [ ] 하단 작업·로그·진행 상태
- [ ] 명령 팔레트
- [ ] 전역 검색
- [ ] 알림
- [ ] diff 승인 화면
- [ ] 플러그인 관리자
- [ ] 설정
- [ ] 프로젝트·패키지·작업·공필 영역 접기와 펼치기
- [ ] 영역 이동, 크기 조절과 도킹 레이아웃 저장

## 16.2 UI 상태

- [ ] 열어둔 패널 복원
- [ ] 프로젝트별 레이아웃
- [ ] 플러그인 제거 시 죽은 패널 정리
- [ ] 패널 crash 격리
- [ ] 키보드 탐색
- [ ] 고해상도/DPI
- [ ] 다크·라이트 테마
- [ ] 대형 문서 virtualize
- [ ] 접근성 라벨

## 16.3 프로필 전환

기존 v0.2.0의 한계인 기본 프로필 하나만 사용하는 상태를 제거한다.

- [ ] 현재 프로필 표시
- [ ] 프로필 전환
- [ ] 프로젝트 기본 프로필
- [ ] 채팅별 고정 프로필
- [ ] 변경 시 컨텍스트 영향 미리보기

---

# 17. Codex 및 AI 통합

## 17.1 격리

공필이 실행한 Codex 환경:

```text
GongpilData/integrations/codex/
```

- [ ] 기존 사용자 `CODEX_HOME`과 섞지 않는다.
- [ ] 공필 프로세스 자식에만 전용 환경을 전달한다.
- [ ] 프로젝트별 권한과 접근 루트를 제한한다.
- [ ] 인증 정보 저장 방식은 별도 보안 검토한다.

## 17.2 기본 작업 흐름

```text
프로젝트 확인
→ 색인 검색
→ 청크 후보 확인
→ 필요한 청크 읽기
→ 컨텍스트 구성 확인
→ 수정안/diff 준비
→ 승인 대기
→ 승인 후 확정
→ 새 revision 재확인
```

- [ ] AI가 원본 파일을 즉시 수정하지 않는다.
- [ ] AI 요청에 포함된 출처를 보존한다.
- [ ] 응답과 변경 제안을 연결한다.
- [ ] 모델 공급자별 어댑터를 플러그인으로 둔다.
- [ ] 네트워크 사용 여부를 명확히 표시한다.
- [ ] 오프라인에서도 AI 외 기능은 동작한다.

---

# 18. 저장소 목표 구조

```text
gongpil/
├─ apps/
│  ├─ launcher/
│  ├─ core/
│  └─ shell-web/
├─ platform/
│  ├─ execution/
│  ├─ plugin-host/
│  ├─ plugin-runtime/
│  └─ updater/
├─ packages/
│  ├─ contracts/
│  ├─ config/
│  ├─ project-model/
│  ├─ document-store/
│  ├─ asset-store/
│  ├─ chat-store/
│  ├─ indexing/
│  ├─ plugin-contracts/
│  ├─ plugin-sdk/
│  ├─ plugin-testing/
│  └─ plugin-cli/
├─ builtin-plugins/
│  ├─ markdown-editor/
│  ├─ search/
│  ├─ map-viewer/
│  ├─ relationship-graph/
│  └─ timeline/
├─ installer/
├─ scripts/
├─ templates/
├─ tests/
│  ├─ integration/
│  ├─ e2e/
│  ├─ fixtures/
│  └─ migration/
├─ docs/
└─ distribution/
```

기본 플러그인은 배포물에 포함될 뿐, 설치 뒤에는 일반 플러그인과 같은 규격·권한·생명주기를 사용한다.

---

# 19. 공통 계약과 오류 모델

## 19.1 계약

- [ ] 모든 RPC 요청에 protocol version
- [ ] request ID
- [ ] trace ID
- [ ] scope ID
- [ ] caller identity
- [ ] cancellation
- [ ] deadline
- [ ] schema validation
- [ ] 크기 제한

## 19.2 오류 형식

```ts
interface GongpilError {
  code: string;
  message: string;
  userMessage?: string;
  retryable: boolean;
  traceId?: string;
  details?: unknown;
}
```

대표 코드:

- `REVISION_CONFLICT`
- `PERMISSION_DENIED`
- `PROJECT_READ_ONLY`
- `FILE_NOT_FOUND`
- `PATH_OUTSIDE_ROOT`
- `PLUGIN_INCOMPATIBLE`
- `PLUGIN_CRASHED`
- `PLUGIN_TIMEOUT`
- `PACKAGE_INVALID`
- `MIGRATION_FAILED`
- `STORAGE_FULL`
- `INDEX_STALE`
- `CANCELLED`

- [ ] 내부 stack trace와 사용자 메시지 분리
- [ ] 재시도 가능 여부 명시
- [ ] trace ID로 로그 찾기
- [ ] 오류 코드의 호환성 정책

---

# 20. 보안과 신뢰 경계

## 20.1 초기 위협 모델

보호 대상:

- 사용자 프로젝트 원본
- 채팅과 장기 기억
- AI 인증 정보
- 공필 업데이트 패키지
- 플러그인 패키지
- 승인 정책

경계:

- Shell ↔ Core
- Core ↔ Plugin Host
- iframe ↔ Shell bridge
- 공필 ↔ 외부 AI
- 공필 데이터 루트 ↔ 외부 연결 폴더
- 설치된 버전 ↔ updater

## 20.2 필수 검사

- [ ] path traversal
- [ ] symlink/junction 탈출
- [ ] ZIP Slip
- [ ] 압축 폭탄
- [ ] 악성 manifest
- [ ] RPC 메시지 크기
- [ ] iframe origin
- [ ] 세션 토큰 유출
- [ ] 로그 내 비밀정보
- [ ] 플러그인 권한 상승
- [ ] 업데이트 서명
- [ ] rollback attack
- [ ] 외부 URL 열기
- [ ] HTML/Markdown XSS

## 20.3 신뢰 수준

초기 버전은 다음을 명시해야 한다.

- 공식 기본 플러그인
- 사용자가 신뢰하여 설치한 로컬 플러그인
- 미서명 또는 개발 모드 플러그인

미서명 플러그인을 설치할 수 있다면 강한 경고와 개발자 모드 분리가 필요하다.

---

# 21. 성능 원칙

사용자는 데이터 배치, 캐시 지역성, 확장성을 중요하게 본다.

## 21.1 기준

- [ ] 전체 재처리보다 증분 처리
- [ ] 큰 목록은 pagination/streaming
- [ ] 대형 문서는 전체 복사 최소화
- [ ] binary asset은 base64 RPC 남용 금지
- [ ] 청크 metadata와 본문 분리 가능
- [ ] SQLite 등 파생 DB는 재생성 가능
- [ ] UI 긴 목록 virtualization
- [ ] watcher event 병합
- [ ] worker 작업 취소
- [ ] 백그라운드 색인 우선순위

## 21.2 측정 시나리오

- [ ] 10,000개 문서
- [ ] 100,000개 청크
- [ ] 1GB 프로젝트
- [ ] 6K 지도
- [ ] 장기 채팅 10,000턴
- [ ] 10개 플러그인 동시 활성
- [ ] 대규모 rename
- [ ] 색인 중 종료와 재시작

성능 목표 수치는 실제 프로토타입 측정 뒤 확정한다.

---

# 22. 테스트 전략

## 22.1 단위 테스트

- path canonicalization
- revision 비교
- patch 적용
- chunk 좌표
- manifest 검증
- 권한 판정
- scope parent 연결
- migration

## 22.2 통합 테스트

- Core ↔ Shell
- Core ↔ Plugin Host
- Plugin UI ↔ bridge
- document proposal ↔ approval ↔ save
- watcher ↔ index
- updater ↔ active version

## 22.3 E2E

- [ ] 깨끗한 Windows 설치
- [ ] 첫 실행
- [ ] 데이터 루트 선택
- [ ] 기존 폴더 프로젝트 연결
- [ ] 문서 검색
- [ ] 채팅과 컨텍스트 조립
- [ ] 변경 제안 승인
- [ ] 지도 플러그인 사용
- [ ] 플러그인 crash 후 코어 생존
- [ ] 플러그인 업데이트
- [ ] 업데이트 실패 후 rollback
- [ ] 프로그램만 제거
- [ ] 재설치 후 기존 데이터 복구
- [ ] 완전 삭제
- [ ] 포터블 실행과 폴더 삭제

## 22.4 장애 주입

- [ ] 저장 중 프로세스 종료
- [ ] 디스크 공간 부족
- [ ] 읽기 전용 파일
- [ ] 손상된 index
- [ ] 손상된 chat turn
- [ ] 플러그인 무한 루프
- [ ] 플러그인 메모리 과다
- [ ] RPC 응답 없음
- [ ] migration 중 실패
- [ ] active.json 손상
- [ ] 네트워크 중단

---

# 23. 개발 단계별 초대형 체크리스트

## Phase 0. 저장소 조사와 설계 기준 고정

### 조사

- [ ] 현재 저장소 트리 출력
- [ ] 사용 언어·패키지 관리자·빌드 도구 확인
- [ ] v0.2.0 실행 성공
- [ ] 기존 사용자 가이드 확인
- [ ] 기존 API 목록
- [ ] 기존 데이터 형식
- [ ] 기존 청크/좌표 규칙
- [ ] 기존 패치 승인 흐름
- [ ] 기존 MCP/Codex 연결
- [ ] 테스트 현황
- [ ] 기술 부채 목록

### 산출물

- [ ] `docs/architecture/current-state.md`
- [ ] `docs/architecture/target-state.md`
- [ ] `docs/architecture/migration-plan.md`
- [ ] ADR 템플릿
- [x] 용어집: `docs/architecture/terminology.md`
- [ ] 데이터 소유권 표

### 완료 조건

- [ ] 현재 구현과 목표 구조의 차이가 명시됨
- [ ] 재사용할 코드와 버릴 코드가 근거와 함께 분리됨
- [ ] 첫 구현 단위가 선택됨

## Phase 1. 공통 계약과 monorepo 골격

- [ ] workspace 설정
- [ ] TypeScript 공통 설정
- [ ] lint/format/test
- [ ] 패키지 경계
- [ ] contract 패키지
- [ ] 오류 모델
- [ ] schema validation
- [ ] 버전 정책
- [ ] CI 기본

완료 조건:

- [ ] 빈 Launcher/Core/Shell이 빌드됨
- [ ] 공통 계약을 중복 선언하지 않음
- [ ] 테스트 한 명령으로 실행

## Phase 2. 자기완결 실행 골격

- [ ] 포함 Node 다운로드/고정/검증 스크립트
- [ ] Launcher가 포함 Node 실행
- [ ] process-local 환경 전달
- [ ] dynamic endpoint
- [ ] session 인증
- [ ] health check
- [ ] Shell 창
- [x] 단일 Instance Runtime 정상 종료와 Client Runtime 생존
- [x] Instance Runtime 재시작과 명시적 Client Runtime 종료
- [ ] 강제 종료 복구
- [ ] 잔류 프로세스 검사
- [ ] portable.marker

완료 조건:

- [ ] 시스템 Node가 없어도 실행
- [ ] PATH/CODEX_HOME/서비스 미변경
- [x] Client Runtime 최종 종료 뒤 공필 자식 프로세스 없음
- [ ] 포터블 폴더 밖에 공필 설정을 남기지 않음

## Phase 3. 프로젝트와 데이터 루트

- [x] machine.json
- [x] dataRoot 선택/검증
- [x] 프로젝트 생성
- [ ] 기존 폴더 연결
- [x] project manifest
- [ ] 읽기 전용
- [ ] lock
- [x] path boundary
- [ ] 데이터 분류
- [ ] 백업 기본

완료 조건:

- [ ] 기존 폴더 파일 이동 없음
- [ ] 프로젝트 닫기 후 lock 정리
- [ ] 외부 루트 쓰기 차단 테스트

## Phase 4. 문서 저장소와 revision

- [ ] file ID
- [ ] snapshot read
- [ ] revision
- [ ] atomic write
- [ ] history
- [ ] conflict
- [ ] encoding/newline
- [ ] create/rename/move/delete proposal
- [ ] 복구

완료 조건:

- [ ] 충돌된 패치가 원본을 덮지 않음
- [ ] 저장 중 crash 뒤 원본 복구 가능
- [ ] 승인 없는 쓰기 경로가 없음

## Phase 5. 청크와 색인

- [ ] parser 인터페이스
- [ ] Markdown parser
- [ ] JSON parser
- [ ] text parser
- [ ] 좌표 모델 확정
- [ ] chunk ID
- [ ] watcher
- [ ] incremental index
- [ ] rebuild
- [ ] index status
- [ ] search API

완료 조건:

- [ ] 색인 삭제 후 원본에서 재생성
- [ ] 한글·한자·이모지 좌표 테스트
- [ ] 변경 파일만 재색인

## Phase 6. 변경 제안과 승인 UI

- [ ] proposal store
- [ ] diff
- [ ] 승인
- [ ] 거절
- [ ] conflict UI
- [ ] 적용 후 검증
- [ ] audit
- [ ] undo proposal

완료 조건:

- [ ] `변경 저장`과 `변경 확정`이 분리됨
- [ ] revision 변경 시 승인 화면에서 경고
- [ ] 여러 파일 패치를 안전하게 중단 가능

## Phase 7. 실행 Flow/Scope/Trace

- [ ] feature registry
- [ ] dispatcher
- [ ] async context
- [ ] cancellation
- [ ] timeout
- [ ] progress
- [ ] JSONL
- [ ] cross-process propagation
- [ ] trace query

완료 조건:

- [ ] 사용자 행동부터 파일 저장까지 하나의 trace로 조회
- [ ] 실패·취소 scope가 열린 상태로 남지 않음
- [ ] 로그에 비밀정보가 노출되지 않음

## Phase 8. 플러그인 계약과 SDK

- [ ] plugin.json schema
- [ ] contributes schema
- [ ] permission list
- [ ] RPC v1
- [ ] SDK facade
- [ ] mock core
- [ ] testing package
- [ ] compatibility matrix

완료 조건:

- [ ] 예제 플러그인이 코어 내부 import 없이 동작
- [ ] API 버전 불일치가 명확히 거부됨
- [ ] 권한 없는 호출이 차단됨

## Phase 9. 플러그인 설치 관리자

- [ ] package validator
- [ ] ZIP 안전성
- [ ] hash
- [ ] signature placeholder/policy
- [ ] permission consent
- [ ] version folders
- [ ] active.json
- [ ] disable
- [ ] uninstall
- [ ] rollback

완료 조건:

- [ ] 실행 중 파일 덮어쓰기 없음
- [ ] 실패 업데이트 뒤 이전 버전 실행
- [ ] 플러그인 삭제 뒤 프로젝트 원본 유지

## Phase 10. 플러그인 격리 실행

- [ ] host process
- [ ] RPC transport
- [ ] heartbeat
- [ ] crash handling
- [ ] restart policy
- [ ] shutdown
- [ ] iframe bridge
- [ ] CSP
- [ ] permission dispatcher

완료 조건:

- [ ] 플러그인 예외가 Core/Shell을 죽이지 않음
- [ ] 플러그인 무한 루프를 중단 가능
- [ ] iframe이 상위 DOM과 파일에 직접 접근하지 못함

## Phase 11. 지도 뷰어 플러그인

- [ ] 6000×4000 지도 자산 등록
- [ ] image viewer
- [ ] zoom/pan
- [ ] coordinate transform
- [ ] layers
- [ ] markers
- [ ] documentRef
- [ ] search
- [ ] plugin storage
- [ ] install/update/remove E2E

완료 조건:

- [ ] 확대/축소 후 표식 좌표 오차 없음
- [ ] 플러그인 제거 뒤 PNG와 프로젝트 metadata 보존
- [ ] 플러그인 crash 뒤 다른 기능 정상

## Phase 12. 채팅·페르소나·컨텍스트

- [ ] chat store
- [ ] turn JSON
- [ ] branch
- [ ] resume
- [ ] persona version
- [ ] profile switch UI
- [ ] context builder
- [ ] source snapshot
- [ ] token budget
- [ ] interrupted streaming

완료 조건:

- [ ] 과거 branch 재개
- [ ] 응답이 사용한 청크와 revision 확인 가능
- [ ] 프로필 변경이 다른 채팅을 오염시키지 않음

## Phase 13. Markdown 편집기와 검색 플러그인

- [ ] Markdown editor
- [ ] preview
- [ ] proposal integration
- [ ] exact range editing
- [ ] search UI
- [ ] filter
- [ ] result → document navigation

완료 조건:

- [ ] 편집기가 직접 저장하지 않고 proposal 생성
- [ ] 정확한 범위 교체 지원
- [ ] 검색 결과 좌표로 안정 이동

## Phase 14. Codex/AI 통합

- [ ] provider plugin contract
- [ ] 공필 전용 Codex 경로
- [ ] process-local environment
- [ ] tool permission
- [ ] context handoff
- [ ] response persistence
- [ ] proposal handoff
- [ ] network/offline state

완료 조건:

- [ ] 기존 사용자 Codex 설정과 격리
- [ ] 승인 없는 원본 변경 없음
- [ ] 실제 사용 컨텍스트를 채팅 이력에서 재현 가능

## Phase 15. 개발자 도구

- [ ] `plugin-cli create`
- [ ] dev folder link
- [ ] backend restart
- [ ] UI hot reload
- [ ] manifest reload
- [ ] RPC inspector
- [ ] permission simulator
- [ ] scope viewer
- [ ] package validator
- [ ] compatibility test

완료 조건:

- [ ] ZIP 재설치 없이 로컬 플러그인 개발
- [ ] 일반 사용자 환경에 전역 CLI 설치 불필요
- [ ] 개발 링크가 공필 설정 안에만 존재

## Phase 16. 설치·업데이트·삭제

- [x] 설치 패키지
- [x] dataRoot 선택
- [x] optional shortcuts
- [x] bundled runtime
- [x] core version package
- [ ] update manifest
- [x] checksum
- [ ] atomic active switch
- [ ] rollback
- [ ] uninstall choices
- [x] portable ZIP

완료 조건:

- [x] 격리된 Windows 환경에서 외부 런타임 없이 설치·실행
- [x] 프로그램만 제거 후 설정과 사용자 지정 데이터 재사용
- [ ] 완전 삭제 대상 사전 표시
- [x] 포터블 폴더 삭제로 종료

## Phase 17. 안정화와 0.1.0 출시

- [ ] E2E 전체
- [ ] crash recovery
- [ ] migration
- [ ] 성능 baseline
- [ ] 보안 검토
- [ ] 라이선스
- [ ] 사용자 가이드
- [ ] 개발자 가이드
- [ ] release notes
- [ ] checksums

출시 범위:

```text
코어:
- 자기완결 실행
- 프로젝트
- 문서·자산 저장
- 채팅 저장
- 패치 승인
- 로그
- 플러그인 관리

기본 플러그인:
- Markdown 편집기
- 검색
- 지도 뷰어

개발 도구:
- plugin-cli
- 개발 폴더 연결
- package validate
```

관계도, 타임라인, 인물 카드, AI 고급 분석은 Plugin API v1 안정화 뒤로 미룬다.

---

# 24. 미결정 사항 목록

다음은 구현 전에 ADR 또는 사용자 확인이 필요하다.

## 아키텍처

- [ ] Tauri 2 확정 여부
- [ ] Inno Setup 확정 여부
- [ ] Core 통신을 dynamic TCP로 할지 named pipe로 할지
- [ ] 다중 창·다중 프로젝트 모델
- [ ] SQLite 사용 범위

## 좌표와 청크

- [ ] 내부 좌표 단위
- [ ] 사람이 보는 16진 좌표 규격 유지 여부
- [ ] 문서 이동/rename ID 추적 방식
- [ ] 청크 ID 안정성 범위
- [ ] 의미 검색 도입 시기

## 보안

- [ ] 공식 플러그인 서명 체계
- [ ] 제3자 미서명 플러그인 허용 범위
- [ ] Node 직접 API 차단 방식
- [ ] Windows AppContainer 도입 시기
- [ ] AI 비밀정보 저장 방식

## 업데이트

- [ ] 업데이트 서버/배포 채널
- [ ] stable/beta 채널
- [ ] 코어와 Plugin API 호환 기간
- [ ] 자동 다운로드와 사용자 승인 정책

## 데이터

- [ ] 채팅 첨부 파일 중복 제거
- [ ] 대용량 binary 자산 저장/연결 방식
- [ ] 프로젝트 외부 파일 참조 정책
- [ ] 백업 보존 수와 용량 정책
- [ ] Git 통합의 기본 여부

---

# 25. 하지 말아야 할 것

- [ ] 시스템 전역 `CODEX_HOME`을 공필용으로 바꾸지 않는다.
- [ ] 시스템 PATH에 공필 Node나 CLI를 추가하지 않는다.
- [ ] 사용자 PC에 전역 npm 패키지를 설치하지 않는다.
- [ ] 설치 시 임의의 Python/Node를 내려받아 시스템에 설치하지 않는다.
- [ ] 프로젝트 원본을 공필 DB 안으로 강제 이동하지 않는다.
- [ ] 색인을 정본처럼 취급하지 않는다.
- [ ] 승인 전 AI/플러그인이 원본을 수정하지 않는다.
- [ ] 기본 플러그인을 코어와 특수 결합하지 않는다.
- [ ] 플러그인 UI를 Shell React 트리에 직접 import하지 않는다.
- [ ] 플러그인 업데이트 시 실행 중인 파일을 덮어쓰지 않는다.
- [ ] 플러그인 삭제와 프로젝트 자산 삭제를 묶지 않는다.
- [ ] 과거 대화 요약을 최신 설정보다 우선하지 않는다.
- [ ] 무협의 정본 설정, 폐기 설정, 추론, 이미지 프롬프트를 한 계층에 섞지 않는다.
- [ ] 성능 측정 없이 복잡한 타일링·분산 처리부터 만들지 않는다.
- [ ] 거대한 일괄 리팩터링으로 검증 지점을 없애지 않는다.

---

# 26. 각 Codex 작업의 보고 형식

각 작업 종료 시 다음 형식으로 보고한다.

```markdown
## 결과
- 무엇이 실제로 동작하게 되었는가

## 변경 파일
- 파일과 역할

## 검증
- 실행한 테스트
- 성공/실패

## 설계 영향
- 확정 규격을 바꾸었는가
- 새 ADR이 필요한가

## 남은 위험
- 아직 검증하지 못한 것

## 다음 한 단계
- 가장 작은 후속 작업
```

“완료”는 코드가 존재한다는 뜻이 아니라, 정의된 완료 조건과 테스트를 통과했다는 뜻이다.

---

# 27. 프로젝트 전체 완료 정의

공필 0.1.0의 전체 구조가 성립했다고 말하려면 다음이 모두 참이어야 한다.

- [ ] 시스템 외부 런타임 없이 깨끗한 Windows에서 실행된다.
- [ ] PATH, 전역 CODEX_HOME, 시스템 서비스를 변경하지 않는다.
- [ ] 설치형과 포터블이 같은 프로젝트를 연다.
- [ ] 기존 사용자 폴더를 파일 이동 없이 프로젝트로 연결한다.
- [ ] 색인을 삭제해도 원본에서 재생성할 수 있다.
- [ ] 모든 원본 변경은 제안·diff·승인·revision 검사를 거친다.
- [ ] 저장 중 실패해도 원본을 복구할 수 있다.
- [ ] 채팅을 턴과 브랜치 단위로 재개할 수 있다.
- [ ] 응답이 사용한 컨텍스트 출처와 revision을 확인할 수 있다.
- [ ] 플러그인은 별도 버전 폴더와 프로세스와 UI 영역을 가진다.
- [ ] 권한 없는 플러그인 API 호출이 거부된다.
- [ ] 플러그인 crash가 Core와 다른 플러그인을 죽이지 않는다.
- [ ] 플러그인 업데이트 실패 시 이전 버전으로 돌아간다.
- [ ] 지도 플러그인이 6000×4000 지도를 안정적으로 다룬다.
- [ ] 지도 플러그인을 제거해도 지도 원본과 프로젝트 데이터가 남는다.
- [ ] 프로그램만 삭제한 뒤 재설치하면 기존 프로젝트를 다시 사용할 수 있다.
- [ ] 완전 삭제는 실제 삭제 경로와 용량을 먼저 보여준다.
- [ ] 포터블은 폴더 삭제로 공필 소유 파일을 제거할 수 있다.
- [ ] 사용자 행동에서 저장까지 trace를 따라갈 수 있다.
- [ ] 개발자는 전역 패키지 설치 없이 플러그인을 만들고 검증할 수 있다.

---

# 28. 최종 설계 문장

> 공필 코어는 사용자 데이터의 안전과 실행 질서를 소유하고, 사용자가 보는 작업 기능은 독립 플러그인으로 제공한다. 프로그램·런타임·버전·플러그인은 공필 소유 루트에 격리하고, 사용자 원본과 장기 데이터는 명시적인 별도 루트에 둔다. 모든 변경은 검색 가능한 근거와 revision을 가진 제안으로 만들어 사용자가 diff를 승인한 뒤에만 적용하며, 설치·실행·업데이트·삭제는 시스템 전역 환경을 건드리지 않는 자기완결 구조로 수행한다.

공필이 목표로 하는 네 가지 격리는 다음과 같다.

```text
설치 격리
실행 격리
데이터 격리
삭제 격리
```

플러그인까지 포함하면 세 가지가 추가된다.

```text
권한 격리
장애 격리
버전 격리
```

이 일곱 가지 격리가 공필 전체 아키텍처를 판단하는 기준이다.
