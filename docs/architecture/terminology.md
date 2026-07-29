# 공필 개발 용어 지침

상태: `CURRENT`

이 문서는 공필을 설계·개발·검토할 때 사용하는 용어의 정본이다. 사용자 화면의 짧은 문구는 쉬운 이름을 쓸 수 있지만, 설계 문서·작업 요청·코드 리뷰에서는 아래의 정확한 이름을 우선한다.

## 1. 기본 규칙

- `Package`는 설치·로딩·실행의 재료가 되는 버전 있는 프로그램 구조를 뜻한다. 클래스가 객체의 구조를 정의하는 것에 대응하는 개념이지만, 특정 언어의 클래스나 npm 패키지만을 뜻하지는 않는다.
- `Runtime`은 Package를 로드해 실제로 실행 중인 프로세스·상태·자원의 집합을 뜻한다. 객체 인스턴스에 대응하는 개념이지만, 반드시 단일 OS 프로세스라는 뜻은 아니다.
- `Package`와 `Runtime`을 서로 바꾸어 쓰지 않는다. 설계 경계가 중요하면 항상 전체 이름을 쓴다.
- `Client`, `Server`, `Instance`, `Core`, `Host Adapter`처럼 짧은 이름은 문맥에서 Package와 Runtime을 모두 아우르거나 어느 쪽인지 명확할 때만 쓴다.
- 공필에서 `Instance`라는 단어는 일반적인 객체 인스턴스가 아니라 제품인 공필을 가리키는 고유 용어다. 실행 객체를 뜻해야 할 때는 반드시 `Instance Runtime`이라고 쓴다.

## 2. 개발과 배포 저장소

| 용어 | 정의 | 현재 또는 목표 구현 |
|---|---|---|
| Development Package(개발 패키지) | 사용자와 Codex가 설계·코딩·테스트하고 Server·Client·Instance Package를 빌드하는 전체 개발 구조 | 현재 로컬 경로는 `G:\novel\mu-wiki\codex\gongpil`이며 경로가 바뀌어도 용어는 유지한다 |
| Source Repository(소스 저장소) | Development Package의 소스와 변경 이력을 저장하고 협업하는 저장소 | 현재는 GitHub `clearsky3411/gongpill-remote-repo`; 나중에 다른 원격 저장소나 미러로 교체할 수 있다 |
| Distribution Repository(배포 저장소) | 검증된 Server·Client·Instance Package, manifest, checksum, signature를 게시하는 저장소 | GitHub Release를 첫 구현 대상으로 삼되, 나중에 전용 클라우드 저장소로 교체할 수 있다 |
| Update Channel(업데이트 채널) | Distribution Repository 안에서 `stable`, `beta`, `dev`처럼 어떤 릴리스를 추적할지 나타내는 논리적 관점 | Client Runtime 설정과 배포 manifest가 함께 결정한다 |

Source Repository와 Distribution Repository는 역할이 다르다. Client Runtime은 `main` 브랜치나 소스 트리를 직접 실행하지 않고, Distribution Repository의 Update Channel과 서명된 manifest를 추적한다.

## 3. 프로그램과 실행 상태

정확한 합성식은 `Server = Server Package + Server Runtime`, `Client = Client Package + Client Runtime`, `Gongpil = Instance = Instance Package + Instance Runtime`이다. `Core`와 `Host Adapter`도 같은 Package/Runtime 규칙을 따른다.

| 총칭 | Package | Runtime |
|---|---|---|
| Server | Server Package: 업데이트 manifest·패키지·서비스 API를 제공하기 위한 서버 프로그램 구조 | Server Runtime: 로컬 또는 클라우드에서 실제로 실행 중인 서버 프로세스 집합 |
| Client | Client Package: Installer가 로컬에 설치하는 접속·설정·업데이트·수명 관리 프로그램 구조 | Client Runtime: 현재 실행 중이며 업데이트를 확인하고 Instance Runtime을 생성·관리하는 프로세스 집합 |
| Gongpil 또는 Instance | Instance Package: 공필 작업 환경을 만들기 위한 버전 있는 Core·Shell·Plugin·Host Adapter 구조 | Instance Runtime: Client Runtime이 Instance Package를 로드해 만든 실제 공필 작업 환경 |
| Core | Core Package: Instance Package에 포함되어 데이터·revision·권한·저장을 담당하는 중앙 하위 프로그램 구조 | Core Runtime: Instance Runtime 안에서 논리적으로 동작하는 Core 실행 상태. 별도 OS 프로세스로 분리될 수 있다 |
| Host Adapter | Host Adapter Package: Instance Runtime을 Browser나 Desktop WebView 같은 출력 호스트에 연결하는 어댑터 프로그램 구조 | Host Adapter Runtime: 선택된 호스트와 통신하며 실행 중인 어댑터 상태 |

Core Package는 Instance Package의 중앙 하위 Package이지 Instance Package 전체와 같은 말이 아니다.

`Host Adapter wrapper`는 구현 기법을 설명할 때만 쓴다. 공식 구성 요소 이름은 `Host Adapter Package`와 `Host Adapter Runtime`이다.

## 4. 포함 관계

```text
Development Package
├─ Server Package
├─ Client Package
└─ Instance Package
   ├─ Core Package
   ├─ Shell Package
   ├─ Plugin Package(s)
   └─ Host Adapter Package(s)

Server Runtime

Client Runtime
└─ Instance Package를 로드해 Instance Runtime(Gongpil)을 생성
   ├─ Core Runtime
   ├─ Shell Runtime
   ├─ Plugin Runtime(s)
   └─ Host Adapter Runtime
```

위 관계는 논리적 소유 관계다. Core Runtime처럼 논리적으로 Instance Runtime에 포함된 구성 요소가 안정성이나 격리를 위해 별도 OS 프로세스로 실행될 수 있다.

## 5. 생성·업데이트·종료 수명

1. 사용자와 Codex는 Development Package 안의 Server Package, Client Package 또는 Instance Package 소스를 수정한다.
2. 검증된 결과를 버전 있는 배포 산출물로 빌드하고 Distribution Repository의 Update Channel에 게시한다.
3. Client Runtime은 Update Channel의 manifest를 확인하고 현재 활성 버전과 비교한다.
4. 새 Package를 기존 Package 위에 직접 덮어쓰지 않고 별도 버전 폴더에 다운로드·검증한다.
5. 검증이 끝나면 Client Runtime이 활성 버전 포인터를 원자적으로 전환한다.
6. Instance Package가 바뀌면 기존 Instance Runtime을 안전하게 종료하고 새 Instance Package로 Instance Runtime을 다시 생성한다.
7. Client Package가 바뀌면 별도 updater가 Client Runtime을 재시작해 새 Client Package를 활성화한다.
8. 실패하면 보존된 이전 Package 버전과 활성 포인터로 롤백한다.

Installer는 최초 Client Package 설치와 복구·제거를 담당한다. 설치 이후의 일반 업데이트는 Client Runtime과 updater의 책임이다.

Instance Runtime 종료는 Client Runtime 종료를 뜻하지 않는다. 장기 목표에서 Client Runtime은 상주하며 여러 차례 Instance Runtime을 열고 닫을 수 있다. 현재 구현은 Browser 종료 요청과 함께 Client·Core도 종료하므로, 이 분리는 아직 `TARGET`이다.

## 6. Browser와 실행 호스트

- 현재 Browser는 Instance Runtime의 기본 출력·입력 호스트다. Browser 자체가 Gongpil 또는 Instance Package인 것은 아니다.
- Instance Package는 Chrome 전용 기능에 밀착하지 않고 표준 Web API, Core API, Host Bridge 경계에 의존한다.
- 현재는 외부 Browser Host를 사용하고, 나중에는 같은 Instance Package를 Desktop WebView Host에서 로드할 수 있어야 한다.
- 호스트마다 필요한 차이는 Host Adapter Package에 격리한다.

## 7. 개발 요청 해석

| 요청 | 정확한 해석 |
|---|---|
| “개발 패키지 작업하자” | 이 저장소의 전체 개발 구조와 공통 설계·빌드 기반을 수정한다 |
| “서버 패키지 작업하자” | 배포·서비스를 제공할 Server Package 소스를 수정한다 |
| “클라이언트 패키지 작업하자” | 설치될 접속·설정·업데이트·수명 관리 프로그램을 수정한다 |
| “클라이언트 런타임이 업데이트한다” | 실행 중인 Client Runtime이 배포 manifest를 확인하고 새 Package를 설치·검증·활성화한다 |
| “인스턴스 패키지 작업하자” | 공필 작업 환경을 구성하는 Core·Shell·Plugin·Host Adapter 구조를 수정한다 |
| “공필을 다시 연다” | Client Runtime이 Instance Package를 로드해 새 Instance Runtime을 생성한다 |
| “호스트 어댑터 작업하자” | 문맥을 확인한 뒤 Host Adapter Package 또는 Host Adapter Runtime 중 정확한 대상을 명시한다 |

## 8. 개발과 공필 작업의 경계

- 기능·디자인 개발은 Development Package에서 사용자와 Codex가 수행한다.
- Instance Runtime 안의 AI는 문서 작성, 대화, 청크, 페르소나, 제안 같은 공통 작업을 돕는다.
- Instance Runtime 안의 AI가 Client Package나 Instance Package의 제품 코드를 스스로 수정·배포하는 기능은 범위에 포함하지 않는다.
- 개발 결과는 검증과 배포 절차를 거쳐 새 Package가 된 뒤 Client Runtime의 업데이트로 사용자에게 전달된다.

## 9. 현재와 목표를 구분하는 표현

- 이미 존재하고 검증된 동작만 `CURRENT`라고 쓴다.
- 용어로 구조를 확정했지만 구현되지 않은 상주 Client Runtime, 독립 Instance Runtime 수명, Update Channel, 서명 검증, 클라우드 Server Runtime은 `TARGET`이라고 쓴다.
- 설계 문장에서 `Client Runtime이 Instance Package를 수정한다`는 표현은 피한다. 개발 도구가 소스를 수정하는 것과 런타임이 새 버전을 설치·활성화하는 것을 구분한다.
- `Client Instance`라는 표현은 쓰지 않고 `Client Runtime`이라고 쓴다.
