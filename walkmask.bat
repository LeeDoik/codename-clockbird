@echo off
chcp 65001 >nul
title 걷는 길 칠하기 — 코드네임: 태엽새
cd /d "%~dp0"

echo.
echo   ================================================
echo     걷는 길 칠하기  (walkmask)
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

REM --- 그림판 대신 다른 편집기를 쓰려면 이 창을 열기 전에
REM     set WALKMASK_EDITOR=C:\경로\Aseprite.exe  처럼 잡아두면 된다 ---
if not defined WALKMASK_EDITOR set "WALKMASK_EDITOR=mspaint"

REM --- 맵 고르기 (인자로 줘도 된다: walkmask.bat hq) ---
set "MAP=%~1"
if not "%MAP%"=="" goto check_map

:menu
echo   어느 맵의 걷는 길을 칠할까요?
echo.
echo     [1] 튜토리얼 본부   (hq)
echo     [2] 스테이지 1 거리 (street)
echo     [3] 스테이지 2 저택 (mansion)
echo     [Enter] 그만두기
echo.
set "PICK="
set "MAP="
set /p "PICK=  번호: "
if /i "%PICK%"=="1" set "MAP=hq"
if /i "%PICK%"=="2" set "MAP=street"
if /i "%PICK%"=="3" set "MAP=mansion"
if not "%MAP%"=="" goto have_map
REM 빈 입력은 그만두기다 — 여기서 무조건 되돌아가면 입력이 끊겼을 때 끝없이 돈다.
if "%PICK%"=="" exit /b 0
echo.
echo   [!] 1, 2, 3 중에 고르세요.
echo.
goto menu

:check_map
if /i "%MAP%"=="hq" goto have_map
if /i "%MAP%"=="street" goto have_map
if /i "%MAP%"=="mansion" goto have_map
echo   [!] 모르는 맵 이름입니다: %MAP%
echo       hq / street / mansion 중 하나를 쓰세요.
echo.
pause
exit /b 1

:have_map
set "MASK=design\walkmask\%MAP%-walk.png"
set "APPLIED=design\walkmask\%MAP%-walk-applied.png"
echo.

REM --- 밑그림. 칠하던 게 있으면 덮어쓰기 전에 반드시 묻는다 ---
if not exist "%MASK%" goto make_template
echo   [!] 이미 칠하던 파일이 있습니다.
echo       %MASK%
echo.
echo     [Enter] 그 파일에 이어서 칠하기
echo     [N]     지금 판정으로 밑그림을 새로 그리기 (칠한 것이 사라집니다)
echo.
set "FRESH="
set /p "FRESH=  선택: "
if /i "%FRESH%"=="n" goto make_template
echo   [*] 칠하던 파일을 그대로 씁니다.
goto paint

:make_template
echo   [1/2] 밑그림 만드는 중...
node scripts/walkmask.js template %MAP%
if errorlevel 1 goto fail

:paint
echo.
echo   ------------------------------------------------
echo     편집기가 열립니다. 이렇게 칠하세요.
echo.
echo       초록 = 걸어갈 수 있는 곳
echo       빨강 = 막힌 곳
echo.
echo     붓 색은 대충 맞아도 됩니다 (초록 계열/빨강 계열이면 됨).
echo     그림판이라면 [도형]의 사각형 + [채우기: 단색]이 빠릅니다.
echo     다 칠했으면 같은 파일에 그대로 저장(Ctrl+S)하고 돌아오세요.
echo   ------------------------------------------------
echo.
start "" "%WALKMASK_EDITOR%" "%MASK%"
echo   칠하고 저장한 뒤에...
pause

echo.
echo   [2/2] 게임에 적용하는 중...
node scripts/walkmask.js import %MAP%
if errorlevel 1 goto fail

echo.
echo   확인용 그림을 엽니다.
echo     빨강 = 막힌 곳
echo     노랑 = 걸을 수 있는데 플레이어가 못 닿는 곳 (실수로 방을 봉했다는 뜻)
start "" "%APPLIED%"
echo.
echo     [R]     더 고쳐 칠하기
echo     [Enter] 끝내기
echo.
set "AGAIN="
set /p "AGAIN=  선택: "
REM 되돌아가는 쪽을 기본값으로 두면 입력이 끊겼을 때 끝없이 돈다 — 나가는 쪽이 기본이다.
if /i "%AGAIN%"=="r" goto paint

echo.
echo   끝났습니다. play.bat 으로 실제로 걸어보세요.
echo.
pause
exit /b 0

:fail
echo.
echo   [!] 실패했습니다. 위 오류 메시지를 확인해주세요.
echo.
pause
exit /b 1
