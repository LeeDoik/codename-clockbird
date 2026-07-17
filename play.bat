@echo off
chcp 65001 >nul
title 코드네임: 태엽새
cd /d "%~dp0"

echo.
echo   ================================================
echo     코드네임: 태엽새  (Codename: Clockbird)
echo   ================================================
echo.

REM --- Node.js 확인 ---
where node >nul 2>nul
if errorlevel 1 (
    echo   [!] Node.js 가 설치되어 있지 않습니다.
    echo       https://nodejs.org 에서 22 버전 이상을 설치한 뒤 다시 실행하세요.
    echo.
    pause
    exit /b 1
)

REM --- .env 확인 ---
if not exist ".env" (
    echo   [!] .env 파일이 없습니다.
    echo       .env.example 을 .env 로 복사한 뒤 ANTHROPIC_API_KEY 를 넣어주세요.
    echo       키 발급: https://console.anthropic.com/settings/keys
    echo.
    pause
    exit /b 1
)

REM --- 재실행 시 3000 포트를 쓰던 기존 서버 정리 (EADDRINUSE 방지) ---
echo   [*] 포트 3000 정리 중...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3000 "') do taskkill /f /pid %%p >nul 2>nul

REM --- 의존성 ---
if not exist "node_modules" (
    echo   [1/3] 의존성 설치 중... 최초 1회, 1~2분 소요
    call npm install
    if errorlevel 1 goto fail
) else (
    echo   [1/3] 의존성 확인 완료
)

REM --- 빌드 ---
echo   [2/3] 게임 빌드 중...
call npm run build
if errorlevel 1 goto fail

REM --- 서버 기동 + 브라우저 자동 열기 ---
echo   [3/3] 서버 기동 중...
echo.
echo   잠시 후 브라우저가 http://localhost:3000 으로 열립니다.
echo   종료하려면 이 창에서 Ctrl+C 를 누르세요.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
call npm start
goto :eof

:fail
echo.
echo   [!] 실행에 실패했습니다. 위 오류 메시지를 확인해주세요.
echo.
pause
exit /b 1
