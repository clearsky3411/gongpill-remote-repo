# Gongpil

공필은 사용자가 소유한 로컬 문서와 자산을 정본으로 유지하면서, 검색·청크·컨텍스트·채팅·변경 제안·승인·플러그인을 통해 사람과 AI가 장기 프로젝트를 함께 작성하고 관리하는 로컬 우선 플랫폼이다.

## 현재 단계

- 상태: `CURRENT` 프로젝트·문서 MVP + Codex/API 공동 집필 + Browser 생존 감지 + Client 홈·패치노트
- 최근 작업 브랜치: `codex/client-home-dashboard`
- 구현 코드: `client/src/`, `core/src/`, `browser/src/`, `platform/network-runtime/`, `tests/mvp/`
- 설계 기준: `GONGPIL_MASTER_CONTEXT_AND_CHECKLIST_KO.md`
- 개발 용어 기준: `docs/architecture/terminology.md`
- 기계 판독 Code Map: `docs/architecture/component-registry.json`
- 기계 판독 부트스트랩 계약: `packages/contracts/bootstrap/bootstrap-contracts.schema.json`
- 기계 판독 네트워크 계약: `packages/contracts/network/network-contracts.schema.json`
- 네트워크 사용 지도: `docs/architecture/network-map.md`
- MVP 릴리스 노트: `docs/releases/0.1.0-mvp.md`

현재 개발 환경에서 실제 사용:

```powershell
npm start
```

처음 실행하면 Windows 클라이언트 홈이 먼저 열린다. `홈`에서 Client·Instance 상태, 지금 가능한 작업과 패치노트를 확인하고 `설정`에서 데이터 폴더와 AI 연결 방식을 정한 뒤 `인스턴스 시작`을 누른다. 기본값은 `Codex Pro (ChatGPT 로그인)`이며, 인스턴스의 `AI 사용 정보`에서 공필 전용 Codex 로그인을 한 번 완료한다. 열린 인스턴스에서 프로젝트와 문서를 만들고, 오른쪽 `공동 집필` 패널에서 AI와 대화하거나 문서 변경안을 요청한다. AI 변경은 원본에 바로 쓰이지 않으며 변경 전후를 확인하고 `적용`을 눌러야 저장된다. 화면의 `인스턴스 종료`는 현재 Instance Runtime만 즉시 끝내며, Browser 창을 닫아 생존 응답이 끊겨도 약 30초 뒤 Instance Runtime만 끝난다. 상주 Client Runtime의 홈에서 새 Instance Runtime을 시작하거나 Client를 최종 종료할 수 있다.

OpenAI API는 별도 과금이 필요한 선택 기능이다. 사용할 때만 API 키를 별도 보안 폴더의 `.env.local`에 `OPENAI_API_KEY=<비밀키>` 형식으로 보관하고 접속기에서 그 파일을 선택한다. 키는 Git 저장소나 Browser에 넣지 않는다. 설치형 설정은 설치 폴더 옆 `GongpilConfig/client-settings.json`에 저장되며 키 값이 아닌 환경파일 경로만 기록한다. Codex 인증은 선택한 `dataRoot/integrations/codex` 아래의 공필 전용 `CODEX_HOME`에 격리된다.

Node 설치 없이 포터블로 사용:

1. `distribution/Gongpil-0.1.0-portable.zip`을 원하는 폴더에 푼다.
2. 압축을 푼 폴더의 `Gongpil.vbs`를 더블클릭한다.
3. 클라이언트(접속기)에서 고정된 `GongpilData` 위치를 확인하고 인스턴스를 시작한다.
4. `GongpilData`가 사용자 데이터이므로 이동·백업할 때 함께 보관한다.

포터블 ZIP은 `npm run build:portable`로 다시 만들고 `npm run test:portable`로 실제 압축 해제·재실행을 검증할 수 있다.

일반 Windows 설치:

1. `distribution/Gongpil-0.1.0-setup.exe`를 실행한다.
2. 설치 후 시작 메뉴의 `Gongpil`을 실행한다.
3. 처음 뜨는 클라이언트(접속기)에서 데이터 폴더를 정하고 `인스턴스 시작`을 누른다.
4. 나중에 바꾸려면 시작 메뉴의 `Gongpil 설정`을 실행한다. 경로 변경은 기존 데이터를 자동 이동하지 않는다.
5. 제거해도 클라이언트 설정과 선택한 프로젝트·문서는 유지되며, 재설치하면 그대로 다시 사용한다.

설치 프로그램은 `npm run build:installer`로 만들고 `npm run test:installer`로 실제 설치·실행·제거·재설치를 검증한다.

개발 검증:

```powershell
npm run demo:bootstrap
npm run demo:network
npm run demo:network:loopback
npm run test:bootstrap
npm run test:client
npm run test:ai
npm run test:diagnostics
npm run test:network
npm run test:mvp
npm run validate:architecture
npm run validate:release
```

## 사용자 검수용 개발 현황

이 절은 공필이 최종적으로 제공해야 할 핵심 기능과 현재 구현 상태를 사람이 직접 비교하는 진행 보고서다. 체크 표시는 코드가 존재하는 것만으로 붙이지 않고, 관련 계약·테스트·Code Map 검증까지 통과한 경우에만 붙인다.

상태 기준:

- `[x]` 구현과 현재 검증 근거가 있음
- `[ ]` 목표는 정해졌지만 아직 완료되지 않음
- `결정 필요` 구현 전에 사용자 확인 또는 ADR이 필요함

### 핵심 기능 전체 체크리스트

- [x] 저장소 구조, 작업 규칙, Code Map과 자동 검증 기반
- [x] Client-Core 부트스트랩 및 NetworkRuntime 공개 계약
- [x] 실제 loopback HTTP JSON/SSE NetworkRuntime 수직 슬라이스
- [x] 포함 런타임으로 동작하는 자기완결 Client-Core 실행
- [x] 설치형·포터블 모드와 독립된 데이터 루트 결정
- [x] Windows 클라이언트(접속기)의 데이터 폴더·시작 옵션 관리
- [x] 상주 Client Runtime과 단일 Instance Runtime 종료·재시작
- [x] Browser heartbeat ACK 만료 시 Instance Runtime 자동 종료와 Client Runtime 생존
- [x] Client 홈의 Runtime 상태·사용 가능 기능·패치노트와 설정 탭
- [x] 외부 API 환경파일 선택과 Browser 비밀키 비노출
- [x] OpenAI Responses API 스트리밍 공동 집필 채팅
- [x] ChatGPT 구독 인증을 쓰는 격리된 Codex App Server 공동 집필
- [x] 인스턴스에서 제공자·구독 한도·토큰·API 예상 비용 확인
- [x] 민감정보 제거 구조화 개발 로그 조회
- [x] 전체 문서 생성·교체 제안, 변경 전후 확인, 승인·거절과 revision 충돌 방지
- [ ] 기존 폴더 연결, 프로젝트 ID, 잠금과 읽기 전용 모드
- [x] 문서 snapshot, file ID, revision, 원자 저장과 충돌 방지
- [x] 청크 파싱, 증분 색인, 검색과 명시 선택 컨텍스트 조립
- [ ] 변경 제안, diff, 승인, 적용, 감사와 원복
- [ ] 실행 Flow/Scope/Trace, 진행률, 취소와 오류 추적
- [ ] 플러그인 계약·SDK·권한·설치 관리자
- [ ] 플러그인별 backend 프로세스와 sandboxed UI 격리
- [ ] 프로젝트·문서·편집·공동 집필 영역 접기·펼치기와 이동·도킹
- [ ] 지도 뷰어 검증 플러그인
- [ ] 채팅, 브랜치, 페르소나, 장기 기억과 출처 추적
- [ ] Markdown 편집기와 검색 플러그인
- [x] 공필 전용 Codex/AI 통합과 개인 환경 격리
- [ ] 플러그인 개발자 도구와 패키지 검증
- [x] Windows 사용자 권한 설치·바로가기·프로그램 제거
- [ ] 자동 업데이트·실패 롤백·사용자 선택 전체 삭제
- [x] Windows x64 포터블 ZIP 배포
- [ ] 보안·성능·장애 복구·E2E 검증 후 `0.1.0` 출시

### 현재 완료 보고: 실제 프로젝트·문서 MVP

- [x] `npm start` 한 번으로 Client가 Core를 시작하고 기본 Browser 화면을 연다
- [x] 일회용 launch URL을 HttpOnly same-origin 쿠키 세션으로 교환한다
- [x] 프로젝트 생성·목록·열기와 안정적인 project ID·manifest를 제공한다
- [x] Markdown·text·JSON 문서 생성·목록·읽기·편집·저장을 제공한다
- [x] 프로젝트 경로 탈출과 Windows 예약 이름을 차단한다
- [x] SHA-256 revision과 expected revision으로 동시 저장 충돌을 차단한다
- [x] 같은 볼륨 임시 파일·flush·rename으로 원자 저장한다
- [x] 저장 전 revision별 history 사본을 남긴다
- [x] Browser에는 endpoint·token·절대 데이터 경로를 공개하지 않는다
- [x] 화면의 Instance 종료 요청 뒤 Core가 끝나고 Client Runtime은 접속기로 돌아간다
- [x] Client Runtime 최종 종료 뒤 Core 자식 프로세스가 남지 않는다
- [x] 실제 Core API와 실제 Client 진입점을 사용하는 MVP 테스트 5개가 통과한다

### 현재 완료 보고: Windows 클라이언트(접속기)

- [x] 웹 작업 화면을 `인스턴스`, 실행·설정 UI를 `클라이언트(접속기)`로 구분한다
- [x] 첫 실행과 시작 메뉴의 `Gongpil 설정`에서 접속기를 연다
- [x] 설치형 데이터 폴더를 찾아보기로 선택하고 절대경로·드라이브 루트·설치 폴더 내부·쓰기 가능 여부를 검사한다
- [x] `client-settings.json`을 flush 후 원자 rename으로 저장하고 손상된 설정을 조용히 덮어쓰지 않는다
- [x] 포터블 데이터 폴더는 앱 옆 `GongpilData`로 고정한다
- [x] 경로 변경 시 기존 데이터를 자동으로 이동하지 않는다고 화면에 표시한다
- [x] 접속기에서 현재 데이터 폴더를 탐색기로 열 수 있다
- [x] 접속기 표시 여부를 저장하고 언제든 `Gongpil 설정`으로 다시 연다
- [x] 인스턴스 favicon을 제공해 `/favicon.svg` 요청이 200을 반환한다
- [x] 설정·PowerShell 응답·Instance 재시작 테스트 8개와 사용자 지정 경로 Installer E2E가 통과한다

### 현재 완료 보고: OpenAI 공동 집필 수직 슬라이스

- [x] 접속기에서 별도 `.env.local`과 `gpt-5.6` 계열 모델을 선택한다
- [x] API 키 값은 Client 설정·Browser HTML·명령 payload에 저장하거나 전달하지 않는다
- [x] 외부 HTTPS 호출은 NetworkRuntime의 OpenAI Responses 어댑터만 소유한다
- [x] 선택 프로젝트·문서 저장본을 컨텍스트로 사용한다
- [x] 응답 delta를 기존 단일 SSE로 인스턴스에 표시한다
- [x] 채팅 message와 변경 proposal을 `dataRoot/chats`에 원자 저장한다
- [x] AI는 원문을 직접 수정하지 않고 `pending` 제안만 생성한다
- [x] 사용자가 변경 전후를 확인하고 적용하거나 거절한다
- [x] 적용 직전 expected revision을 검사하고 기존 문서 history를 남긴다
- [x] mock OpenAI 서버를 사용하는 실제 Client-Core E2E가 통과한다

### 현재 완료 보고: Codex 제공자·사용량·개발 로그

- [x] 접속기 기본 제공자를 `Codex Pro (ChatGPT 로그인)`로 두고 OpenAI API를 선택형 별도 과금 경로로 유지한다
- [x] 공필 전용 `dataRoot/integrations/codex`에만 process-local `CODEX_HOME`을 전달한다
- [x] Codex App Server의 초기화, 계정 조회, 로그인 시작, thread/turn, 구조화 출력과 종료를 구현한다
- [x] Codex는 읽기 전용 sandbox에서 응답·proposal만 만들고 원본 적용은 기존 사용자 승인 명령만 수행한다
- [x] 인스턴스 `AI 사용 정보`에서 모델·인증·플랜·구독 한도·최근 토큰을 확인한다
- [x] OpenAI API는 공식 표준 단가와 실제 usage로 요청별 예상 달러 비용을 표시한다
- [x] 인스턴스 `개발 로그`에서 Core·Codex·API 실행 결과를 확인한다
- [x] 로그 허용목록 테스트로 키·인증 URL·문서 경로·문서 내용을 제외한다
- [x] 실제 Codex 0.145 App Server 스키마 생성과 격리 계정 상태 조회를 확인한다

사용자가 직접 확인할 항목:

- [ ] 새 설치본의 접속기에서 `Codex Pro (ChatGPT 로그인)`를 선택하고 인스턴스를 시작한다
- [ ] `AI 사용 정보` → `ChatGPT로 Codex 로그인`을 눌러 공필 전용 로그인을 완료한다
- [ ] 프로젝트·문서를 선택하고 공동 집필 요청 뒤 토큰 정보가 갱신되는지 확인한다
- [ ] `개발 로그`에서 키·문서 내용 없이 실행 상태만 보이는지 확인한다
- [ ] 접속기에서 `OpenAI API (별도 과금)`로 바꾸면 예상 비용 문구가 표시되는지 확인한다

### 현재 완료 보고: 청크·좌표·증분 색인·검색

- [x] Markdown heading, JSON 최상위 구조, text 문단 기준 파서를 제공한다
- [x] 내부 좌표를 `revision + UTF-8 byte [start,end)`로 고정하고 줄 번호·8자리 16진 범위를 표시용으로 제공한다
- [x] 한글·한자·이모지·결합 문자·CRLF에서 byte 범위로 원문을 정확히 복원한다
- [x] 32KB 초과 청크를 UTF-8 문자 경계를 깨지 않고 하위 분할한다
- [x] 문서 revision이 바뀐 경우에만 해당 문서 청크를 다시 만들고 미변경 문서 chunk ID를 유지한다
- [x] 누락·손상 색인은 사용자 원본에서 다시 생성할 수 있는 파생 JSON으로 저장한다
- [x] 프로젝트 전체 키워드 검색과 문서별 청크 목록 Core 명령을 제공한다
- [x] 인스턴스에서 현재 문서 청크·검색 결과를 여러 개 선택하고 AI 요청에 명시 전달한다
- [x] 오래된 chunk ID와 1MB 초과 선택 컨텍스트를 Core에서 거부한다

사용자가 직접 확인할 항목:

- [ ] heading이 여러 개인 Markdown 문서를 열어 각 heading 청크와 byte 좌표가 보이는지 확인한다
- [ ] 청크 검색으로 다른 문서의 결과를 찾고 여러 개를 선택한다
- [ ] 공동 집필 요청 뒤 선택한 청크만 AI 컨텍스트로 전달되는지 답변으로 확인한다
- [ ] 문서를 수정·저장하면 이전 선택이 정리되고 새 청크 좌표가 표시되는지 확인한다

### 현재 완료 보고: 페르소나·컨텍스트·출처 snapshot

- [x] 프로젝트별 기본 페르소나와 작업 프로필을 `dataRoot/personas`에 원자 저장한다
- [x] 기존 페르소나를 덮어쓰지 않고 새 버전을 누적해 과거 채팅의 의미를 보존한다
- [x] 인스턴스에서 페르소나·버전·작업 프로필을 즉시 전환하고 새 항목을 저장한다
- [x] 작업 프로필마다 1,000~200,000 범위의 컨텍스트 토큰 예산을 설정한다
- [x] 명시 선택 청크를 chunk ID로 중복 제거하고 예산 초과 출처 개수와 경고를 숨기지 않는다
- [x] 실제 AI 입력에 포함된 출처만 파일·revision·UTF-8 byte·line·내용 SHA-256·원문 snapshot으로 채팅에 저장한다
- [x] 문서가 나중에 수정돼도 당시 사용한 출처 내용과 페르소나 버전을 채팅에서 다시 확인한다
- [x] 기존 메타데이터 없는 채팅 JSON을 그대로 읽는 하위 호환 테스트를 제공한다

사용자가 직접 확인할 항목:

- [ ] 공동 집필 패널 위에서 페르소나·버전·작업 프로필을 바꿔본다
- [ ] `페르소나·프로필 편집`을 열어 새 버전과 새 프로필을 저장한다
- [ ] 여러 청크를 선택하고 AI 요청 뒤 사용자 메시지의 `사용 출처`를 펼친다
- [ ] 파일·줄·byte·revision과 당시 원문이 표시되는지 확인한다
- [ ] 토큰 예산을 1,000으로 낮추고 큰 청크를 선택해 누락 경고가 보이는지 확인한다

사용자가 직접 확인할 항목:

- [ ] OpenAI Platform API 프로젝트에 크레딧 또는 사용 한도를 설정한다
- [ ] `Gongpil 설정`에서 `OPENAI_API_KEY`가 든 `.env.local`을 선택한다
- [ ] 프로젝트와 문서를 선택하고 공동 집필 패널에서 수정안을 요청한다
- [ ] 변경 전후를 펼쳐 본 뒤 `적용`하고 편집기 내용이 바뀌는지 확인한다
- [ ] 제안을 하나 더 만들어 `거절`하고 원문이 유지되는지 확인한다

클라이언트(접속기)를 사용자가 직접 확인할 항목:

- [ ] 시작 메뉴의 `Gongpil`에서 접속기 창이 먼저 보이는지 확인
- [ ] `찾아보기...`로 새 데이터 폴더를 선택하고 `인스턴스 시작`을 누른다
- [ ] 프로젝트와 문서를 만든 뒤 종료하고, 다시 실행해 같은 내용이 보이는지 확인
- [ ] `인스턴스 종료` 뒤 접속기가 다시 나타나고 같은 Client Runtime에서 인스턴스를 다시 시작하는지 확인
- [ ] 접속기의 `클라이언트 종료`를 누르면 프로그램이 최종 종료되는지 확인
- [ ] 시작 메뉴의 `Gongpil 설정`에서 경로와 접속기 표시 옵션을 다시 바꿔본다

프로젝트·문서 기능을 사용자가 직접 확인할 항목:

- [ ] `npm start`로 공필 화면이 열리는지 확인
- [ ] 프로젝트와 `draft/1장.md` 문서를 만들고 내용을 저장
- [ ] 공필을 종료 후 다시 실행해 저장한 내용이 남아 있는지 확인
- [ ] `npm run test:mvp`가 5개 테스트를 모두 통과하는지 확인

### 완료 보고: NetworkRuntime loopback 수직 슬라이스

- [x] 명령·결과·이벤트·상태·오류의 v1 JSON 계약 정의
- [x] 네트워크 접속 교체, 송신, 구독, 취소와 상태 관측 facade
- [x] 순수 상태 머신과 in-memory transport
- [x] `127.0.0.1:0`에서 OS가 선택한 동적 포트 사용
- [x] 16자 이상 세션 토큰 인증
- [x] HTTP JSON 명령과 정규화된 결과 반환
- [x] 세션당 SSE stream 하나만 유지
- [x] SSE 강제 단절 뒤 자동 재접속
- [x] 고장 난 후보 접속 거부와 기존 연결 롤백
- [x] NetworkRuntime 밖의 직접 네트워크 사용 탐지
- [x] 실제 소켓 통합 테스트를 포함한 네트워크 테스트 11개
- [x] Bootstrap Contract, Network Contract, Network Map, Code Map 검증

사용자가 직접 확인할 항목:

- [ ] `npm run demo:network:loopback`에서 동적 포트가 출력되는지 확인
- [ ] HTTP 결과가 `succeeded`인지 확인
- [ ] SSE 최대 동시 연결 수가 `1`인지 확인
- [ ] 강제 단절 뒤 누적 연결 수가 증가하고 이벤트를 다시 받는지 확인
- [ ] 고장 난 후보가 거부된 뒤 기존 profile로 명령이 성공하는지 확인
- [ ] `npm run test:network`가 11개 테스트를 모두 통과하는지 확인
- [ ] `npm run validate:architecture`가 네 가지 아키텍처 검증을 모두 통과하는지 확인

### 완료 보고: Client-Core loopback bootstrap 수직 슬라이스

- [x] 설치형·포터블 app/data/version/session/runtime 경로 결정
- [x] 지정된 `bundledRuntimePath`로 실제 Core 자식 프로세스 시작
- [x] stdin 한 줄 `ClientBootstrapConfig` 전달
- [x] 자식 프로세스 환경에만 32-byte 무작위 세션 토큰 전달
- [x] Core stdout 한 줄 `CoreReadyInfo`와 후보 `NetworkConnectionProfile` handoff
- [x] protocol·Core 버전·health 검증 뒤 NetworkRuntime 활성화
- [x] 호환되지 않는 후보 종료와 기존 Core·NetworkRuntime 유지
- [x] Browser 요약에서 절대 경로·origin·port·token·secret 제외
- [x] 시작 실패 정규화와 정상 종료 뒤 잔류 Core 0개 검증
- [x] 부모 `PATH`, `CODEX_HOME`, 세션 토큰 환경 무변경 검증

사용자가 직접 확인할 항목:

- [ ] `npm run demo:bootstrap`에서 Core `1.0.0` 활성화 성공 확인
- [ ] health HTTP 결과가 `succeeded`인지 확인
- [ ] Browser 요약에 경로·port·token이 없는지 확인
- [ ] 호환되지 않는 `2.0.0` 후보가 거부되고 `1.0.0`이 유지되는지 확인
- [ ] 종료 뒤 `[잔류 Core] 0`인지 확인
- [ ] `npm run test:bootstrap`이 5개 테스트를 모두 통과하는지 확인

## 상세 구현 체크리스트

아래 목록은 마스터 계획의 Phase 0~17을 현재 저장소 상태에 맞게 요약한 것이다. 더 세부적인 정책과 완료 조건은 `GONGPIL_MASTER_CONTEXT_AND_CHECKLIST_KO.md`를 정본으로 삼는다.

### Phase 0. 저장소 조사와 설계 기준

- [x] 최상위 컴포넌트 책임과 저장소 골격 정의
- [x] 작업 규칙과 코드 스타일 정의
- [x] 기계 판독 `component-registry.json` 작성
- [x] 사람이 읽는 `code-map.md` 작성
- [x] Code Map 구조·경로·대칭 관계 검증기 작성
- [ ] 기존 구현과 목표 구조의 차이를 별도 문서로 정리
- [ ] 재사용·폐기 대상과 기술 부채 목록 작성
- [ ] ADR 템플릿 작성
- [x] 개발 패키지·저장소·Package/Runtime 용어집 작성
- [ ] 데이터 소유권 표 작성

### Phase 1. 공통 계약과 실행 가능한 골격

- [x] Node 기반 workspace 실행 진입점 작성
- [x] Client-Core 부트스트랩 JSON Schema 작성
- [x] NetworkRuntime v1 JSON Schema 작성
- [x] 공개 오류와 프로토콜 버전 경계 정의
- [x] 계약 자동 검증 스크립트 작성
- [ ] 공통 TypeScript 설정과 패키지별 빌드 구성
- [ ] lint·format·전체 테스트 명령 통합
- [ ] CI 기본 검사
- [ ] 빈 Client·Core·Shell 빌드 확인

### Phase 2. 자기완결 Client-Core 실행

- [x] 실제 동적 loopback endpoint 실험
- [x] 세션 토큰 인증과 health/readiness route
- [x] 후보 접속 검증 뒤 원자적 교체와 실패 롤백
- [x] 포함 Node 24.18.0 LTS 버전 고정·공식 SHA-256 검증·패키징
- [x] Client가 설치형·포터블 경로 결정
- [x] Client가 포함 Node로 Core 프로세스 시작
- [x] Client가 지정된 `bundledRuntimePath`로 Core 프로세스 시작
- [x] CoreReadyInfo 표준 출력 handoff
- [x] 경로·연결 비밀정보 없는 Browser 논리 세션 공개
- [x] 기본 브라우저에서 인스턴스 시작
- [x] Client Runtime 상주와 단일 Instance Runtime 정상·비정상 종료 뒤 재시작
- [x] 정상 종료·시작 실패·잔류 프로세스 정리
- [ ] 비정상 종료 감지와 고아 프로세스 복구
- [x] 시스템 PATH와 전역 `CODEX_HOME` 무변경 검증

### Phase 3. 프로젝트와 데이터 루트

- [x] `machine.json`과 `dataRoot` 생성·검증
- [x] 클라이언트에서 설치형 `dataRoot` 선택·검증·설정 저장
- [x] 새 프로젝트 생성
- [ ] 기존 폴더 연결
- [x] project manifest와 안정적인 project ID
- [ ] 읽기 전용 모드와 동시 실행 잠금
- [x] canonical path와 외부 루트 탈출 방지
- [ ] 원본·파생 데이터·캐시·로그 분류
- [ ] 기본 백업과 프로젝트 닫기 정리

### Phase 4. 문서 저장소와 revision

- [x] 논리 경로 기반 안정적인 file ID
- [ ] rename/move 추적
- [x] snapshot read와 revision 반환
- [x] expected revision 기반 충돌 검사
- [x] 같은 볼륨 임시 파일을 이용한 원자 저장
- [x] UTF-8 인코딩과 줄바꿈 상태 판별
- [ ] 생성·이름 변경·이동·삭제 proposal
- [ ] 저장 실패와 crash 복구
- [ ] 승인 없는 원본 쓰기 경로 차단

### Phase 5. 청크와 증분 색인

- [x] parser 인터페이스와 Markdown·JSON·text parser
- [x] revision + UTF-8 byte 내부 좌표 모델 확정
- [x] 안정적인 chunk ID와 source address
- [ ] watcher event 병합
- [x] 변경 파일만 처리하는 incremental index
- [ ] 색인 전체 rebuild와 상태 공개
- [x] 색인 삭제·손상 뒤 원본에서 재생성
- [ ] 파일명·heading·전문·태그·참조 검색 API

### Phase 6. 변경 제안과 승인

- [x] 전체 문서 생성·교체 proposal 저장소와 기준 revision
- [ ] 전체·범위·다중 파일 patch 검증
- [x] 전체 문서 변경 전후와 변경 이유 표시
- [ ] 승인 전 수정, 부분 승인, 거절과 보관
- [x] 적용 직전 revision 재검사
- [ ] 충돌 경고와 안전한 재기반
- [x] 적용 뒤 재읽기·문서 변경 이벤트·history 기록
- [ ] 원복 proposal 생성

### Phase 7. 실행 Flow, Scope와 Trace

- [ ] feature registry와 dispatcher
- [ ] 부모·자식 scope와 async context 전달
- [ ] timeout, 취소와 진행률
- [ ] 프로세스 경계를 넘는 trace 전파
- [x] 구조화 JSONL 실행 로그 조회
- [ ] 사용자 행동부터 저장까지 하나의 trace로 연결
- [x] 로그 비밀정보 제거

### Phase 8. 플러그인 계약과 SDK

- [ ] `plugin.json`과 contributes schema
- [ ] 버전 있는 RPC v1 계약
- [ ] 최소 권한 목록과 권한 판정
- [ ] 문서 snapshot·proposal·asset·event API
- [ ] SDK facade와 mock Core
- [ ] 플러그인 테스트 패키지와 호환성 행렬
- [ ] 내부 Core import와 권한 없는 호출 차단

### Phase 9. 플러그인 설치 관리자

- [ ] `.gongpil-plugin` 패키지 검사
- [ ] ZIP Slip·압축 폭탄·파일 수·크기 제한
- [ ] SHA-256과 서명 정책
- [ ] 권한 설명과 사용자 동의
- [ ] 버전별 설치 폴더와 `active.json`
- [ ] 시험 실행, 활성화, 비활성화와 제거
- [ ] 업데이트 실패 시 이전 버전 롤백
- [ ] 플러그인 제거 뒤 프로젝트 원본 보존

### Phase 10. 플러그인 격리 실행

- [ ] 플러그인별 backend 프로세스
- [ ] heartbeat, timeout과 crash 감지
- [ ] 재시작 제한과 정상·강제 종료
- [ ] sandboxed iframe과 `postMessage` bridge
- [ ] origin·session 검증과 CSP
- [ ] 권한 dispatcher와 감사 로그
- [ ] 플러그인 장애가 Core·Shell·다른 플러그인에 전파되지 않음

### Phase 11. 지도 뷰어 검증 플러그인

- [ ] 6000×4000 지도 자산 등록
- [ ] 확대·축소·이동과 좌표 변환
- [ ] layer, marker와 document reference
- [ ] 검색과 플러그인 전용 저장소
- [ ] 설치·업데이트·삭제 E2E
- [ ] 확대율 변화 뒤 marker 좌표 오차 검증
- [ ] 제거 뒤 PNG와 프로젝트 metadata 보존

### Phase 12. 채팅·페르소나·컨텍스트

- [x] 프로젝트별 chat message와 proposal의 안정적인 ID
- [x] 프로젝트별 JSON 저장과 재실행 후 대화 표시
- [x] Responses API text delta 스트리밍
- [x] persona 버전과 작업 profile 전환
- [x] 검색 청크 명시 선택
- [x] 이전 대화 최근 10턴 기본 선택과 최근 N턴 재선택
- [x] 이전 대화 턴 전체·메시지 청크 개별 선택과 전체 해제
- [x] 대화 주제·작업·세션·라벨 분류 편집과 필터 선택
- [ ] 자동 추가 청크와 명시 선택 청크 구분
- [x] 토큰 예산, 중복 제거와 누락 경고
- [x] 응답에 사용한 파일·범위·revision snapshot 기록
- [x] 응답에 사용한 대화 message ID·역할·시각·분류·byte 좌표·hash snapshot 기록
- [x] 문서·대화 통합 토큰·포함 순서·중복·누락 사유 전송 전 미리보기
- [ ] 이전 대화 원문·요약본·선택 청크 모드와 요약 비용 표시
- [ ] 원본과 분리된 수정·삭제 가능한 장기 기억

### Phase 13. Markdown 편집기와 검색 플러그인

- [ ] Markdown 편집과 미리보기
- [ ] 직접 저장 대신 proposal 생성
- [ ] 정확한 범위 교체
- [ ] 검색 UI, filter와 결과 이동
- [ ] 검색 결과 좌표로 안정적인 문서 navigation

### Phase 14. Codex와 AI 통합

- [x] NetworkRuntime 소유 OpenAI Responses API 어댑터
- [x] 공필 전용 Codex 작업 경로
- [x] process-local `CODEX_HOME`과 환경 격리
- [x] 읽기 전용 Codex 실행과 원본 적용 사용자 승인
- [x] 선택 프로젝트·문서 저장본 컨텍스트 handoff
- [x] 응답·토큰 사용량·제공자 옵션 관측
- [x] AI 결과를 원본 쓰기가 아닌 proposal로 전달
- [ ] offline·network 상태 표시

### Phase 15. 개발자 도구

- [ ] `plugin-cli create`
- [ ] 개발 폴더 link와 manifest reload
- [ ] backend restart와 UI hot reload
- [ ] RPC inspector와 permission simulator
- [ ] scope·trace viewer
- [ ] package validator와 compatibility test
- [ ] 전역 패키지 설치 없이 플러그인 개발

### Phase 16. 설치·업데이트·삭제

- [x] Windows 설치 패키지
- [x] Windows 포터블 ZIP
- [x] 포함 런타임과 Core 버전 패키지
- [ ] update manifest와 checksum
- [ ] 실행 중 파일을 덮어쓰지 않는 원자 활성 버전 전환
- [ ] 실패 업데이트 rollback
- [ ] 프로그램만·캐시 포함·전체 삭제 선택지
- [ ] 삭제 전 실제 경로와 예상 용량 표시
- [x] 재설치 뒤 기존 설정과 사용자 지정 데이터 재사용

### Phase 17. 안정화와 `0.1.0` 출시

- [ ] 깨끗한 Windows 설치·첫 실행 E2E
- [ ] 프로젝트·검색·채팅·proposal 전체 흐름 E2E
- [ ] 플러그인 crash·업데이트·rollback E2E
- [ ] 저장·migration·색인 장애 주입과 복구
- [ ] 10,000문서·100,000청크·1GB 프로젝트 성능 기준
- [ ] 보안 검토, 라이선스와 checksum
- [x] MVP 사용자·개발자 가이드와 release notes
- [x] 설치형·포터블·삭제 후 데이터 복구 검증

### 구현 전 결정이 필요한 항목

- [ ] Tauri 2와 Windows 설치 도구 최종 확정
- [x] 로컬 Core 통신 v1은 dynamic loopback TCP의 HTTP JSON/SSE로 확정
- [ ] 다중 창·다중 프로젝트 모델
- [ ] SQLite 사용 범위
- [ ] Unicode 내부 좌표와 chunk ID 안정성 범위
- [ ] 공식·제3자 플러그인 서명과 신뢰 수준
- [x] 외부 `.env.local` 경로만 Client 설정에 보관하고 키는 Core 메모리에서만 사용
- [ ] 업데이트 서버·채널·자동 다운로드 정책
- [ ] 대용량 binary 자산과 외부 파일 참조 정책
- [ ] Git 통합을 사용자 기능의 기본값으로 둘지 여부

### 완료 작업: Client-Core loopback bootstrap

- [x] Code Map의 작업 단위를 `client-core-loopback-bootstrap-slice`로 전환
- [x] Client가 설치형·포터블 경로와 session 경계를 결정
- [x] 최소 Core 프로세스를 실제로 시작하고 종료
- [x] Core가 `CoreReadyInfo`와 후보 `NetworkConnectionProfile`을 전달
- [x] Client NetworkRuntime이 readiness·protocol을 검증
- [x] 성공 시 후보 연결을 활성화하고 실패 시 기존 Core를 유지
- [x] Browser에는 경로·port·token이 없는 `BrowserSessionSummary`만 공개
- [x] 정상 종료, 시작 실패와 후보 롤백 통합 테스트
- [x] Code Map과 사용자 검수 체크리스트 갱신

### 완료 작업: bundled runtime packaging

- [x] 배포 Node 24.18.0 LTS와 공식 SHA-256 검증 기준 확정
- [x] 설치형·포터블 공용 패키지에 runtime 배치
- [x] `bundledRuntimePath`가 시스템 Node와 PATH 없이 실행되는지 검증
- [ ] runtime 누락·손상 시 사용자 오류와 복구 경로 검증

### 완료 작업: persistent Client Runtime lifecycle

- [x] Client Runtime의 `idle`, `starting`, `running`, `stopping`, `stopped` 상태 경계
- [x] Instance Runtime 정상 종료 뒤 Core 참조·세션 토큰·NetworkRuntime 연결 정리
- [x] 같은 Client Runtime에서 새 launch ID·session ID로 Instance Runtime 재시작
- [x] Core 비정상 종료 뒤 Client Runtime 생존과 수동 복구 재시작
- [x] Browser의 `instance.shutdown.request`와 이전 `system.shutdown.request` 호환 별칭
- [x] 일반 실행은 접속기로 복귀하고 자동화용 `--no-open`은 one-shot 호환 유지
- [x] 최종 Client Runtime 종료 뒤 잔류 Core 프로세스 0개 확인

## 최상위 책임

| 경로 | 책임 |
|---|---|
| `client/` | Windows 클라이언트(접속기)에서 모드·경로·옵션을 정하고 Core와 인스턴스 수명을 관리한다. |
| `core/` | 프로젝트·문서·자산·revision·권한·승인·저장을 최종 집행한다. |
| `browser/` | 실제 저장 경로를 알지 않고 Core의 논리 API를 사용하는 작업 인스턴스다. |
| `installer/` | 설치형·포터블 패키지와 제거·배포 자원을 관리한다. |
| `platform/` | 단일 Network Runtime, 실행 추적, 플러그인 호스트·런타임, 업데이트 기반을 제공한다. |
| `packages/` | 공통 계약과 재사용 가능한 도메인 패키지를 제공한다. |
| `builtin-plugins/` | 기본 제공 기능을 일반 플러그인 규격으로 구현한다. |

## Code Map 확인

작업 전 다음 두 파일에서 기능 위치와 현재 작업 대상을 확인한다.

- `docs/architecture/component-registry.json`
- `docs/architecture/code-map.md`

검증 명령:

```powershell
& .\scripts\validate-code-map.ps1
```

## 작업 원칙

- 코드를 만들기 전에 현재 상태와 기존 문서를 조사한다.
- 기능과 확정되지 않은 제안을 구분한다.
- Browser에 파일 시스템 절대 경로나 저장 기준점을 노출하지 않는다.
- 원본 변경은 제안·diff·승인·revision 검사를 거친다.
- 변경 단위마다 Code Map과 테스트 위치를 함께 갱신한다.
