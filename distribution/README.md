# Distribution

상태: `CURRENT`

검증을 마친 설치형·포터블·플러그인 패키지와 체크섬이 생성되는 산출물 영역이다.

원본 소스나 사용자 데이터는 이 폴더에 저장하지 않는다.

현재 빌드 산출물:

- `Gongpil-0.1.0-portable.zip`: Node 24.18.0 LTS 포함 Windows x64 포터블 패키지
- `Gongpil-0.1.0-portable.zip.sha256`: 배포 ZIP SHA-256
- `Gongpil-0.1.0-setup.exe`: 사용자 권한 Windows Installer
- `Gongpil-0.1.0-setup.exe.sha256`: Windows Installer SHA-256

산출물은 재생성 가능하므로 Git에는 포함하지 않는다. `npm run test:portable`은 ZIP을 새 임시 폴더에 풀고 시스템 `PATH`가 비어 있는 상태에서 포함 runtime으로 두 번 실행하여 데이터 재사용과 정리를 검증한다.
