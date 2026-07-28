# Installer

상태: `CURRENT` (포터블 ZIP과 Windows Installer)

Installer는 공필의 설치형·포터블 배포, 업데이트와 제거 자원을 관리한다.

## 책임

- 포함 런타임과 버전 패키지 배치
- 설치형과 포터블 패키지 생성
- 선택적 바로가기와 최소 레지스트리 항목
- 프로그램·캐시·사용자 데이터 삭제 범위 분리
- 체크섬, 활성 버전 전환과 롤백 지원

Installer는 외부 연결 프로젝트의 사용자 원본을 자동 삭제하지 않는다.

## 포터블 패키지

```powershell
npm run build:portable
npm run test:portable
```

`build-portable.ps1`는 공식 Node.js v24.18.0 LTS Windows x64 ZIP과 `SHASUMS256.txt`를 `nodejs.org`에서 받아, 고정 SHA-256 `0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821`과 실제 파일을 모두 비교한다. 산출물은 `distribution/Gongpil-0.1.0-portable.zip`과 `.sha256`이다.

ZIP을 푼 뒤 `Gongpil.vbs`를 더블클릭하면 콘솔 없이 실행된다. 문제 확인이 필요하면 `Gongpil.cmd --no-open`을 사용한다. 프로젝트 데이터는 포터블 폴더의 `GongpilData`에 저장되므로 폴더 전체를 함께 이동해야 한다.

## Windows Installer

```powershell
npm run build:installer
npm run test:installer
```

Inno Setup 6.7.3의 `ISCC.exe`로 `distribution/Gongpil-0.1.0-setup.exe`와 `.sha256`을 만든다. 기본 설치 위치는 `%LOCALAPPDATA%\Programs\Gongpil`이며 관리자 권한을 요청하지 않는다. 시작 메뉴 바로가기를 만들고 바탕 화면 바로가기는 선택 사항이다.

제거 프로그램은 앱 파일과 앱 내부 runtime 상태만 삭제하고 `%LOCALAPPDATA%\Gongpil`의 프로젝트·문서는 보존한다. 설치 테스트는 임시 위치에 실제 설치하고 포함 Node로 데이터를 만든 뒤 제거·재설치하여 같은 데이터를 다시 읽는다.

현재 Setup.exe는 별도 상용 코드 서명 인증서로 서명하지 않았으므로 배포 전 서명 절차가 남아 있다. Inno Setup 자체의 상업적 사용 여부에 따라 제작 도구 라이선스도 확인해야 한다.
