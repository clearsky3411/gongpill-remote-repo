# Core

상태: `TARGET`

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
