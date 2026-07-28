# Gongpil

공필은 사용자가 소유한 로컬 문서와 자산을 정본으로 유지하면서, 검색·청크·컨텍스트·채팅·변경 제안·승인·플러그인을 통해 사람과 AI가 장기 프로젝트를 함께 작성하고 관리하는 로컬 우선 플랫폼이다.

## 현재 단계

- 상태: `CURRENT` 실제 Browser 화면에서 프로젝트와 문서를 생성·편집·안전 저장하는 사용 가능 MVP 완성
- 최근 완료 작업 브랜치: `codex/usable-project-document-mvp`
- 구현 코드: `client/src/`, `core/src/`, `browser/src/`, `platform/network-runtime/`, `tests/mvp/`
- 설계 기준: `GONGPIL_MASTER_CONTEXT_AND_CHECKLIST_KO.md`
- 기계 판독 Code Map: `docs/architecture/component-registry.json`
- 기계 판독 부트스트랩 계약: `packages/contracts/bootstrap/bootstrap-contracts.schema.json`
- 기계 판독 네트워크 계약: `packages/contracts/network/network-contracts.schema.json`
- 네트워크 사용 지도: `docs/architecture/network-map.md`

현재 개발 환경에서 실제 사용:

```powershell
npm start
```

화면에서 프로젝트 이름을 입력해 만든 뒤, 문서 경로(예: `draft/1장.md`)를 추가하고 편집하여 저장한다. 종료할 때는 화면 오른쪽 위의 `공필 종료`를 누른다. 현재 이 명령은 시스템에 설치된 Node를 사용하며, Node 없이 실행되는 포터블 ZIP과 Windows Installer는 다음 작업에서 만든다.

개발 검증:

```powershell
npm run demo:bootstrap
npm run demo:network
npm run demo:network:loopback
npm run test:bootstrap
npm run test:network
npm run test:mvp
npm run validate:architecture
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
- [ ] 포함 런타임으로 동작하는 자기완결 Client-Core 실행
- [x] 설치형·포터블 모드와 독립된 데이터 루트 결정
- [ ] 기존 폴더 연결, 프로젝트 ID, 잠금과 읽기 전용 모드
- [x] 문서 snapshot, file ID, revision, 원자 저장과 충돌 방지
- [ ] 청크 파싱, 증분 색인, 검색과 컨텍스트 조립
- [ ] 변경 제안, diff, 승인, 적용, 감사와 원복
- [ ] 실행 Flow/Scope/Trace, 진행률, 취소와 오류 추적
- [ ] 플러그인 계약·SDK·권한·설치 관리자
- [ ] 플러그인별 backend 프로세스와 sandboxed UI 격리
- [ ] 지도 뷰어 검증 플러그인
- [ ] 채팅, 브랜치, 페르소나, 장기 기억과 출처 추적
- [ ] Markdown 편집기와 검색 플러그인
- [ ] 공필 전용 Codex/AI 통합과 개인 환경 격리
- [ ] 개발자 도구와 플러그인 패키지 검증
- [ ] Windows 설치·업데이트·롤백·삭제와 포터블 배포
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
- [x] 화면 종료 요청 뒤 Client와 Core가 잔류 프로세스 없이 끝난다
- [x] 실제 Core API와 실제 Client 진입점을 사용하는 MVP 테스트 5개가 통과한다

사용자가 직접 확인할 항목:

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
- [ ] ADR 템플릿, 용어집과 데이터 소유권 표 작성

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
- [ ] 포함 Node 버전 고정·검증·패키징
- [x] Client가 설치형·포터블 경로 결정
- [ ] Client가 포함 Node로 Core 프로세스 시작
- [x] Client가 지정된 `bundledRuntimePath`로 Core 프로세스 시작
- [x] CoreReadyInfo 표준 출력 handoff
- [x] 경로·연결 비밀정보 없는 Browser 논리 세션 공개
- [ ] Browser/Shell 창 시작
- [x] 정상 종료·시작 실패·잔류 프로세스 정리
- [ ] 비정상 종료 감지와 고아 프로세스 복구
- [x] 시스템 PATH와 전역 `CODEX_HOME` 무변경 검증

### Phase 3. 프로젝트와 데이터 루트

- [x] `machine.json`과 `dataRoot` 생성·검증
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

- [ ] parser 인터페이스와 Markdown·JSON·text parser
- [ ] Unicode를 고려한 내부 좌표 모델 확정
- [ ] 안정적인 chunk ID와 source address
- [ ] watcher event 병합
- [ ] 변경 파일만 처리하는 incremental index
- [ ] 색인 전체 rebuild와 상태 공개
- [ ] 색인 삭제 뒤 원본에서 재생성
- [ ] 파일명·heading·전문·태그·참조 검색 API

### Phase 6. 변경 제안과 승인

- [ ] proposal 저장소와 기준 revision
- [ ] 전체·범위·다중 파일 patch 검증
- [ ] diff, 변경 이유, 근거와 영향 범위 표시
- [ ] 승인 전 수정, 부분 승인, 거절과 보관
- [ ] 적용 직전 revision 재검사
- [ ] 충돌 경고와 안전한 재기반
- [ ] 적용 뒤 재읽기·색인 갱신·감사 기록
- [ ] 원복 proposal 생성

### Phase 7. 실행 Flow, Scope와 Trace

- [ ] feature registry와 dispatcher
- [ ] 부모·자식 scope와 async context 전달
- [ ] timeout, 취소와 진행률
- [ ] 프로세스 경계를 넘는 trace 전파
- [ ] 구조화 JSONL 로그와 trace 조회
- [ ] 사용자 행동부터 저장까지 하나의 trace로 연결
- [ ] 로그 비밀정보 제거

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

- [ ] chat·branch·turn의 안정적인 ID
- [ ] 턴 단위 JSON 저장과 과거 branch 재개
- [ ] streaming 중단·재시도·대체 응답 처리
- [ ] persona 버전과 작업 profile 전환
- [ ] 검색 청크 선택과 자동 추가 구분
- [ ] 토큰 예산, 중복 제거와 누락 경고
- [ ] 응답에 사용한 파일·범위·revision snapshot 기록
- [ ] 원본과 분리된 수정·삭제 가능한 장기 기억

### Phase 13. Markdown 편집기와 검색 플러그인

- [ ] Markdown 편집과 미리보기
- [ ] 직접 저장 대신 proposal 생성
- [ ] 정확한 범위 교체
- [ ] 검색 UI, filter와 결과 이동
- [ ] 검색 결과 좌표로 안정적인 문서 navigation

### Phase 14. Codex와 AI 통합

- [ ] provider plugin 계약
- [ ] 공필 전용 Codex 작업 경로
- [ ] process-local `CODEX_HOME`과 환경 격리
- [ ] 도구 권한과 사용자 승인
- [ ] 조립한 컨텍스트 handoff
- [ ] 응답·실제 사용 출처·옵션 저장
- [ ] AI 결과를 원본 쓰기가 아닌 proposal로 전달
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

- [ ] Windows 설치 패키지와 포터블 ZIP
- [ ] 포함 런타임과 Core 버전 패키지
- [ ] update manifest와 checksum
- [ ] 실행 중 파일을 덮어쓰지 않는 원자 활성 버전 전환
- [ ] 실패 업데이트 rollback
- [ ] 프로그램만·캐시 포함·전체 삭제 선택지
- [ ] 삭제 전 실제 경로와 예상 용량 표시
- [ ] 재설치 뒤 기존 데이터 재사용

### Phase 17. 안정화와 `0.1.0` 출시

- [ ] 깨끗한 Windows 설치·첫 실행 E2E
- [ ] 프로젝트·검색·채팅·proposal 전체 흐름 E2E
- [ ] 플러그인 crash·업데이트·rollback E2E
- [ ] 저장·migration·색인 장애 주입과 복구
- [ ] 10,000문서·100,000청크·1GB 프로젝트 성능 기준
- [ ] 보안 검토, 라이선스와 checksum
- [ ] 사용자·개발자 가이드와 release notes
- [ ] 설치형·포터블·삭제 후 데이터 복구 검증

### 구현 전 결정이 필요한 항목

- [ ] Tauri 2와 Windows 설치 도구 최종 확정
- [x] 로컬 Core 통신 v1은 dynamic loopback TCP의 HTTP JSON/SSE로 확정
- [ ] 다중 창·다중 프로젝트 모델
- [ ] SQLite 사용 범위
- [ ] Unicode 내부 좌표와 chunk ID 안정성 범위
- [ ] 공식·제3자 플러그인 서명과 신뢰 수준
- [ ] AI 비밀정보 저장 방식
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

### 다음 작업: bundled runtime packaging

- [ ] 배포할 Node 버전과 무결성 검증 기준 확정
- [ ] 설치형·포터블 패키지에 runtime 배치
- [ ] `bundledRuntimePath`가 시스템 Node 없이 실행되는지 검증
- [ ] runtime 누락·손상 시 사용자 오류와 복구 경로 검증

## 최상위 책임

| 경로 | 책임 |
|---|---|
| `client/` | Browser 실행 전에 모드·경로·버전·세션 기준을 결정하고 Core 수명을 관리한다. |
| `core/` | 프로젝트·문서·자산·revision·권한·승인·저장을 최종 집행한다. |
| `browser/` | 실제 저장 경로를 알지 않고 Core의 논리 API를 사용하는 사용자 인터페이스다. |
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
