@echo off
setlocal
set "GONGPIL_ROOT=%~dp0"
"%GONGPIL_ROOT%runtime\node.exe" "%GONGPIL_ROOT%client\src\client-process.ts" %*
exit /b %ERRORLEVEL%
