@echo off
chcp 65001 >nul
title 프롬프트 스튜디오 — 코드네임: 태엽새
cd /d "%~dp0"

echo.
echo   ================================================
echo     프롬프트 스튜디오  (prompt studio)
echo   ================================================
echo.
echo   페르소나·저택 인물·꼬마·시스템 프롬프트를 고치고,
echo   저장하기 전에 실제 Claude 로 돌려볼 수 있습니다.
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

REM --- .env 확인. 미리보기가 전부 실제 API 호출이라 키가 없으면 편집만 됩니다 ---
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
    echo   [1/2] 의존성 설치 중... 최초 1회, 1~2분 소요
    call npm install
    if errorlevel 1 goto fail
) else (
    echo   [1/2] 의존성 확인 완료
)

REM --- 서버 기동 + 브라우저 자동 열기 ---
REM
REM play.bat 과 달리 **개발 모드**로 띄웁니다 (npm run dev:server).
REM 스튜디오는 파일을 쓰는 API 라 제출 빌드(NODE_ENV=production)에서는 전 라우트가
REM 403 입니다 — play.bat 으로 띄운 서버에서 /prompt-studio 를 열면 안 열립니다.
REM 빌드도 하지 않습니다. 스튜디오는 Express 가 직접 내려주는 한 장짜리 페이지라
REM 게임 클라이언트(Vite) 가 필요 없습니다.
echo   [2/2] 서버 기동 중... (개발 모드)
echo.
echo   잠시 후 브라우저가 http://localhost:3000/prompt-studio 로 열립니다.
echo   고친 내용은 [저장] 을 눌러야 파일에 반영됩니다.
echo   종료하려면 이 창에서 Ctrl+C 를 누르세요.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000/prompt-studio"
call npm run dev:server
goto :eof

:fail
echo.
echo   [!] 실행에 실패했습니다. 위 오류 메시지를 확인해주세요.
echo.
pause
exit /b 1
