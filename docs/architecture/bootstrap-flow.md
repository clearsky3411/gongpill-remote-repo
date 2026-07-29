# Bootstrap Flow

상태: `CURRENT`

## 목표 흐름

```text
Installer가 프로그램과 포함 런타임을 배치
→ Client 시작
→ Client가 설치형/포터블 모드를 판정
→ Client가 appRoot, dataRoot, versionRoot, sessionTemp를 확정
→ Client가 포함 런타임으로 Core를 실행
→ Client가 stdin 한 줄로 설정을 보내고 자식 환경에만 세션 토큰을 주입
→ Core가 전달받은 경계를 검증하고 표준 출력으로 health와 NetworkConnectionProfile을 반환
→ Client의 NetworkRuntime이 후보 연결을 검증하고 원자적으로 교체
→ Client가 Browser 창을 연다
→ Browser는 same-origin NetworkRuntime으로 Core API를 사용한다
→ Instance Runtime 종료 뒤 Client Runtime은 접속기로 돌아간다
→ 사용자가 새 Instance Runtime을 시작하거나 Client Runtime을 종료한다
```

현재 `CURRENT` 범위는 한 번에 하나의 Instance Runtime을 실행하고 정상·비정상 종료 뒤 다시 시작하는 수명 분리다. 여러 Instance Runtime 동시 실행, 자동 재시작, updater와 Update Channel 연동은 후속 `TARGET`이다. 자동화용 `--no-open`과 명시적인 데이터 루트 override 실행은 기존 패키지 검증을 위해 한 번의 Instance Runtime 종료 뒤 Client Runtime도 끝나는 one-shot 경계를 유지한다.

기계 판독 계약과 호환성 규칙은 `bootstrap-contract.md`와 `packages/contracts/bootstrap/bootstrap-contracts.schema.json`에 정의한다.

## Core 독립 업데이트 흐름

```text
Updater가 새 Core를 별도 버전 폴더에 배치하고 검증 자료를 준비
→ Client가 새 버전을 후보로 선택
→ 기존 활성 Core 버전 정보를 보존
→ 후보 Core에 ClientBootstrapConfig 전달
→ 후보 Core가 표준 출력으로 CoreReadyInfo와 NetworkConnectionProfile 반환
→ Client가 protocol 범위, health와 후보 연결 검사
→ 성공 시 활성 버전 포인터 원자 전환
→ Browser에 새 BrowserSessionSummary 공개
→ 실패 시 후보 종료, 기존 Core 유지, rollback 상태 공개
```

Core 프로그램 폴더를 실행 중에 덮어쓰지 않는다. Client는 후보 Core가 준비됐다는 근거를 받은 뒤에만 활성 버전을 바꾼다.

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

이 경로들은 `ClientBootstrapConfig` 안에서 Core에만 전달된다.

## Browser 공개 정보

Browser에는 실제 저장 경로 대신 논리 상태만 제공한다.

```ts
interface BrowserSessionSummary {
  protocolVersion: {
    major: number;
    minor: number;
  };
  sessionId: string;
  mode: "installed" | "portable";
  coreStatus: "starting" | "ready" | "failed" | "rolled-back";
  coreVersion?: string;
  coreApiVersion?: string;
  activeProjectId?: string;
  activeProjectName?: string;
  readOnly: boolean;
  updateState: "idle" | "activating" | "active" | "rolled-back";
  capabilities: string[];
  error?: BootstrapError;
}
```

위 TypeScript 표기는 설명용이다. 현재 기계 정본은 JSON Schema다.

## 금지 경계

- Browser에 `appRoot`, `dataRoot`, `versionRoot`, `sessionTemp`를 전달하지 않는다.
- Browser가 로컬 파일 절대 경로를 조합하지 않는다.
- Client가 문서 revision이나 변경 제안을 직접 처리하지 않는다.
- Core가 운영체제 전역 환경을 영구 변경하지 않는다.
- 후보 Core 검증 전에 활성 버전 포인터를 변경하지 않는다.
- Core가 자신의 설치 폴더를 직접 교체하거나 활성화하지 않는다.
- 기능 코드가 NetworkRuntime 밖에서 네트워크 연결을 직접 만들지 않는다.
- Browser에 NetworkConnectionProfile, origin, port와 인증 정보를 전달하지 않는다.
- 세션 token을 JSON 설정, 명령행 인자, stdout·stderr 또는 운영체제 전역 환경에 기록하지 않는다.

통신은 로컬에서 loopback TCP 위의 HTTP JSON과 SSE를 사용하고, 클라우드에서는 같은 계약을 HTTPS와 HTTP/2로 제공한다. 상세 경계는 `network-runtime.md`에서 확인한다.
