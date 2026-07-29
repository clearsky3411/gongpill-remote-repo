# Installer

상태: `CURRENT` (포터블 ZIP과 Windows Installer)

Installer는 공필의 설치형·포터블 배포, 업데이트와 제거 자원을 관리한다.

## 책임

- 포함 런타임과 버전 패키지 배치
- 설치형과 포터블 패키지 생성
- Client Runtime 사용자 글꼴 폴더와 96 DPI 기준 화면 최초값 설정
- 선택적 바로가기와 최소 레지스트리 항목
- 프로그램·캐시·사용자 데이터 삭제 범위 분리
- 체크섬, 활성 버전 전환과 롤백 지원

Installer는 외부 연결 프로젝트의 사용자 원본을 자동 삭제하지 않는다.

## 포터블 패키지

```powershell
npm run build:portable
npm run test:portable
```

`build-portable.ps1`는 공식 Node.js v24.18.0 LTS Windows x64 ZIP과 `SHASUMS256.txt`를 `nodejs.org`에서 받아, 고정 SHA-256 `0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821`과 실제 파일을 모두 비교한다. 산출물은 `distribution/Gongpil-0.1.1-portable.zip`과 `.sha256`이며 Windows 클라이언트(접속기)도 포함한다.

ZIP을 푼 뒤 `Gongpil.vbs`를 더블클릭하면 콘솔 없이 실행된다. 문제 확인이 필요하면 `Gongpil.cmd --no-open`을 사용한다. 프로젝트 데이터는 포터블 폴더의 `GongpilData`에 저장되므로 폴더 전체를 함께 이동해야 한다.

## Windows Installer

```powershell
npm run build:installer
npm run test:installer
```

Inno Setup 6.7.3의 `ISCC.exe`로 `distribution/Gongpil-0.1.1-setup.exe`와 `.sha256`을 만든다. 기본 설치 위치는 `%LOCALAPPDATA%\Programs\Gongpil`이며 관리자 권한을 요청하지 않는다. 시작 메뉴에 `Gongpil`, `Gongpil 설정`, 제거 바로가기를 만들고 바탕 화면 바로가기는 선택 사항이다. 설치 중 Client Runtime 사용자 글꼴 폴더, 기본 글자 크기, UI 배율과 96 DPI 기준 창 크기를 정할 수 있다.

Installer는 `GongpilConfig/client-settings-seed.json`을 기존 설정이나 시드가 없을 때만 만든다. Client Runtime은 첫 실행에 이를 검증하고 `client-settings.json`으로 원자 저장한 뒤 시드를 제거한다. 이전 버전 설정과 기존 `client-settings.json`이 항상 우선하므로 재설치가 사용자 화면 설정을 덮어쓰지 않는다. 제거 프로그램은 앱 파일과 앱 내부 runtime 상태만 삭제하고 클라이언트 설정과 선택한 dataRoot의 프로젝트·문서는 보존한다. 설치 테스트는 임시 위치에 실제 설치하고 최초 시드 소비, 사용자 지정 dataRoot, 제거·재설치와 기존 설정 보존을 검증한다.

현재 Setup.exe는 별도 상용 코드 서명 인증서로 서명하지 않았으므로 배포 전 서명 절차가 남아 있다. Inno Setup 자체의 상업적 사용 여부에 따라 제작 도구 라이선스도 확인해야 한다.
