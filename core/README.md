# Core

상태: `CURRENT` (프로젝트·문서 저장 + AI 공동 집필 제안 + 이전 대화 컨텍스트)

Core는 공필 데이터와 권한을 최종 집행하는 프로세스다.

## 책임

- 프로젝트 열기·닫기와 읽기 전용 상태
- 문서·자산·채팅·페르소나 저장
- 안정적인 ID와 revision
- 변경 제안, diff, 승인, 충돌 검사와 원자적 저장
- 플러그인 권한과 이벤트 집행
- 백업·복구와 파생 데이터 재생성
- 시작 시 자신의 Core·API·protocol 버전과 health를 Client에 보고
- NetworkRuntime host로 모든 명령 수신, 결과·이벤트 송신과 상태 집계

## 경계

- 경로 기준은 Client가 전달한 부트스트랩 정보에서 받는다.
- Browser 요청을 스키마와 권한으로 검증한다.
- route, HTTP JSON, SSE와 접속 상태 처리는 NetworkRuntime 밖으로 분산하지 않는다.
- Browser 자산과 API를 같은 origin에서 제공한다.
- 플러그인이 원본 파일에 직접 접근하지 못하게 한다.
- Core는 자신의 버전 폴더나 활성 버전 포인터를 직접 변경하지 않는다.

## 현재 구현

`src/core-process.ts`는 stdin의 `ClientBootstrapConfig` 한 줄을 검증하고 실제 loopback host를 시작한다. `src/project-store.ts`는 machine 정보, 프로젝트 manifest와 workspace를 관리하며, `src/document-store.ts`는 논리 경로 경계, snapshot, SHA-256 revision, 동시 충돌 검사, history와 원자 저장을 집행한다.

`src/chat-store.ts`는 프로젝트별 채팅·주제/작업/세션 분류와 문서 제안을 `dataRoot/chats`에 원자 저장한다. `src/chat-history-context.ts`는 이전 대화를 답글 관계의 턴과 UTF-8 byte 좌표 청크로 만들며 최근 턴·전체 턴·개별 청크 선택을 현재 프로젝트 안에서만 해석한다.

`chat.context.preview`와 `chat.message.send`는 문서 청크와 선택한 대화 청크를 같은 토큰 예산에서 조립한다. 동일 내용과 예산 초과 항목은 이유를 `GongpilContextSnapshot.omissions`에 남기며, 실제 포함된 대화의 메시지 ID·역할·시각·분류·내용 hash를 저장한다. 과거 메시지의 `contextSnapshot`은 다시 입력에 넣지 않는다.

원문 변경은 계속 `proposal.apply`만 expected revision 검사 뒤 `document-store`를 통해 집행한다. `proposal.reject`는 원문을 건드리지 않는다.

현재 명령은 health/readiness, Browser session, 프로젝트·문서 CRUD, 채팅 읽기·전송, `chat.history.list`, `chat.context.preview`, `chat.message.classification.update`, proposal 적용·거절과 `instance.shutdown.request`다. 이전 Browser 호환을 위해 `system.shutdown.request`도 같은 Instance Runtime 종료 별칭으로 유지한다. 읽기 전용 잠금, 기존 폴더 연결, rename/move/delete, 부분 diff 승인과 원복은 후속 목표다.
