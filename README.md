# Gongpil

공필은 사용자가 소유한 로컬 문서와 자산을 정본으로 유지하면서, 검색·청크·컨텍스트·채팅·변경 제안·승인·플러그인을 통해 사람과 AI가 장기 프로젝트를 함께 작성하고 관리하는 로컬 우선 플랫폼이다.

## 현재 단계

- 상태: `CURRENT` 단일 NetworkRuntime의 in-memory 및 실제 loopback HTTP/SSE 수직 슬라이스 완성
- 활성 브랜치: `codex/bootstrap-structure`
- 구현 코드: `platform/network-runtime/src/`
- 설계 기준: `GONGPIL_MASTER_CONTEXT_AND_CHECKLIST_KO.md`
- 기계 판독 Code Map: `docs/architecture/component-registry.json`
- 기계 판독 부트스트랩 계약: `packages/contracts/bootstrap/bootstrap-contracts.schema.json`
- 기계 판독 네트워크 계약: `packages/contracts/network/network-contracts.schema.json`
- 네트워크 사용 지도: `docs/architecture/network-map.md`

첫 실행 확인:

```powershell
npm run demo:network
npm run demo:network:loopback
npm run test:network
npm run validate:architecture
```

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
