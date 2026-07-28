# 2026-07-28 재개 인수인계: Codex sandbox 오류와 이전 대화 컨텍스트

## 저장 시점 상태

- 기준 브랜치: `main`의 `fa68951` (`feat: add persona context and source snapshots (#12)`)
- 현재 배포물: `distribution/Gongpil-0.1.0-setup.exe`, `distribution/Gongpil-0.1.0-portable.zip`
- 완료 범위: Codex/API 제공자, 사용량·개발 로그, 문서 청크·UTF-8 byte 좌표·증분 색인·검색, 페르소나 버전·작업 프로필, 출처 snapshot
- 아직 전체 제품 완성 상태는 아니다.

## 재개 시 가장 먼저 고칠 오류

관측 로그:

```text
2026. 7. 28. 오후 8:41:50 · codex · CODEX_REQUEST_FAILED
Invalid request: unknown variant `readOnly`, expected one of `read-only`, `workspace-write`, `danger-full-access`
{"provider":"codex"}
```

예상 원인:

- Codex App Server 요청의 sandbox 값에 `readOnly`를 보내고 있다.
- 현재 App Server 계약이 요구하는 직렬화 값은 `read-only`다.
- 재개 직후 `core/src/codex-app-server-client.ts`의 요청 payload와 테스트 fixture를 확인해 최소 수정한다.
- 수정 뒤 실제 격리 `CODEX_HOME`을 사용한 Codex 요청과 `npm run test:ai`, `npm run validate:release`를 검증한다.

로그인 시 ChatGPT 페이지로 이동하는 것은 Codex Pro가 ChatGPT 계정 인증을 사용하는 브라우저 로그인 흐름이므로 그 자체는 정상이다. 다만 로그인 완료 뒤 공필 인스턴스가 계정 상태를 다시 읽어 `준비됨`으로 바뀌는지 검증해야 한다.

## 다음 핵심 기능: 이전 대화 컨텍스트 선택

현재는 문서 청크와 현재 요청의 출처 snapshot은 있으나, 이전 채팅 기록을 다음 요청의 컨텍스트로 선택하는 기능이 없다.

필수 사용자 흐름:

- [ ] 프로젝트 채팅의 사용자/AI 메시지를 턴 쌍으로 표시한다.
- [ ] 최근 대화 N개를 한 번에 선택한다. 기본 예시는 최근 10개이며 사용자가 개수를 바꿀 수 있다.
- [ ] 각 대화를 개별 체크·해제한다.
- [ ] 대화를 주제·작업·세션 등으로 분류하고 분류 단위로 선택한다.
- [ ] 한 대화 안에서도 내용이 크면 메시지/청크 단위로 나누어 필요한 부분만 선택한다.
- [ ] 문서 청크와 대화 청크를 한 컨텍스트 목록에서 출처 종류로 명확히 구분한다.
- [ ] 선택 직후 예상 토큰, 포함 순서, 중복 제거 결과, 누락 예정 항목을 미리 보여준다.
- [ ] 토큰 예산 초과 시 조용히 버리지 않고 무엇이 빠졌는지 표시한다.
- [ ] 선택 추가·해제·최근 N개 선택·전체 해제가 적은 클릭으로 가능해야 한다.
- [ ] AI 요청에 실제 포함된 이전 대화의 message ID, 역할, 시각, 분류, 내용 hash/snapshot을 보존한다.
- [ ] 문서 청크와 이전 대화가 같은 내용을 반복하면 중복을 제거하되 사용자가 결과를 확인할 수 있어야 한다.
- [ ] 이전 대화 원문, 요약본, 선택 청크 중 무엇을 넣을지 사용자가 선택할 수 있어야 한다.

## 구현 원칙

- 토큰 절약을 기본으로 하되 사용자 명시 선택을 임의로 숨기지 않는다.
- 자동 포함과 사용자 명시 포함을 구분한다.
- 과거 채팅 파일을 깨지 않는 하위 호환 마이그레이션을 유지한다.
- 서로 다른 프로젝트의 채팅이나 청크가 섞이지 않게 Core에서 검증한다.
- Browser는 절대 경로·인증 정보에 접근하지 않는다.
- 원문 적용은 계속 proposal과 사용자 승인 경계를 통과한다.

## 권장 다음 작업 순서

1. `readOnly` → App Server 계약의 `read-only` 수정과 실제 Codex 로그인 후 요청 검증
2. Code Map 작업 단위를 `chat-history-context-selection`으로 등록
3. 채팅 메시지/턴 청크 모델과 토큰 예산 미리보기 Core API 구현
4. 최근 N개·개별·분류·청크 선택 UI 구현
5. 실제 포함 기록을 기존 `GongpilContextSnapshot`에 대화 출처로 확장
6. 기존 채팅 JSON 호환, 중복 제거, 예산 초과, 프로젝트 격리, UI 계약 테스트
7. 설치형·포터블 전체 릴리스 검증과 PR

## 재개 문장

```text
docs/NEXT_WORK_2026-07-28_CHAT_HISTORY_CONTEXT.md를 읽고, 먼저 Codex sandbox의 readOnly 오류를 수정·검증한 뒤 이전 대화 컨텍스트 선택 작업을 계획부터 이어가.
```
