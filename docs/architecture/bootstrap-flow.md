# Bootstrap Flow

상태: `TARGET`

## 목표 흐름

```text
Installer가 프로그램과 포함 런타임을 배치
→ Client 시작
→ Client가 설치형/포터블 모드를 판정
→ Client가 appRoot, dataRoot, versionRoot, sessionTemp를 확정
→ Client가 포함 런타임으로 Core를 실행
→ Core가 전달받은 경계를 검증하고 health 상태를 반환
→ Client가 Browser 창을 연다
→ Browser는 논리 세션 정보로 Core API를 사용한다
```

## Client 내부 부트스트랩 정보

아래 정보는 Client와 Core 경계에서만 필요하다.

```ts
interface BootstrapPaths {
  appRoot: string;
  dataRoot: string;
  versionRoot: string;
  sessionTemp: string;
  bundledRuntimePath: string;
}
```

## Browser 공개 정보

Browser에는 실제 저장 경로 대신 논리 상태만 제공한다.

```ts
interface BrowserSessionSummary {
  sessionId: string;
  mode: "installed" | "portable";
  coreStatus: "starting" | "ready" | "failed";
  activeProjectId?: string;
  activeProjectName?: string;
  readOnly: boolean;
}
```

## 금지 경계

- Browser에 `appRoot`, `dataRoot`, `versionRoot`, `sessionTemp`를 전달하지 않는다.
- Browser가 로컬 파일 절대 경로를 조합하지 않는다.
- Client가 문서 revision이나 변경 제안을 직접 처리하지 않는다.
- Core가 운영체제 전역 환경을 영구 변경하지 않는다.
- 통신 방식은 dynamic TCP와 named pipe 비교 후 ADR로 확정한다.
