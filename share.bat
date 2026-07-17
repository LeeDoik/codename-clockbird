@echo off
chcp 65001 >nul
title 태엽새 - 팀원 공유 링크
cd /d "%~dp0"

echo.
echo   ================================================
echo     팀원 공유 링크 만들기 (cloudflared)
echo   ================================================
echo.

REM --- cloudflared 없으면 자동 다운로드 (최초 1회, 약 55MB) ---
if not exist "cloudflared.exe" (
    echo   [*] cloudflared 다운로드 중... 최초 1회, 약 55MB
    curl -sL -o cloudflared.exe "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    if errorlevel 1 (
        echo   [!] 다운로드 실패. 인터넷 연결을 확인하세요.
        pause
        exit /b 1
    )
)

REM --- 게임 서버(3000)가 켜져 있는지 확인 ---
curl -s -o nul http://localhost:3000/api/health
if errorlevel 1 (
    echo   [!] 게임 서버가 꺼져 있습니다.
    echo       먼저 play.bat 을 실행해 서버를 켠 뒤, 이 창을 그대로 두고 다시 실행하세요.
    echo.
    pause
    exit /b 1
)

echo   [*] 공개 링크 생성 중...
echo.
echo   ▶ 아래 상자 안의  https://....trycloudflare.com  주소를 팀원에게 보내세요.
echo     팀원은 그 링크만 열면 됩니다 (설치·키·비밀번호 불필요).
echo.
echo   ※ 이 창을 닫거나 PC를 끄면 링크가 끊깁니다. 공유하는 동안 켜두세요.
echo   ※ 매번 실행할 때마다 주소가 새로 바뀝니다.
echo.

cloudflared.exe tunnel --url http://localhost:3000 --no-autoupdate
