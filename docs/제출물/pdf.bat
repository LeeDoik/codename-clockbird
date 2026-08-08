@echo off
chcp 65001 > nul
REM ============================================================
REM  제출 문서 HTML -> PDF 재생성
REM
REM  HTML 을 고친 뒤 이 파일을 더블클릭하면 PDF 3종이 다시 구워진다.
REM  pandoc / wkhtmltopdf 같은 별도 설치 없이, 이미 깔려 있는
REM  Chrome 의 headless 인쇄 기능만 쓴다.
REM ============================================================

setlocal
cd /d "%~dp0"

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist "%CHROME%" (
    echo   [!] Chrome / Edge 를 찾지 못했습니다.
    echo       위 CHROME 경로를 직접 수정하세요.
    pause
    exit /b 1
)

echo.
echo   제출 문서 PDF 생성 중...
echo.

for %%F in (01_게임소개서 02_AI활용기술문서 03_팀원롤기술서) do (
    REM 2^>nul 로 Chrome 의 USB/GPU 경고를 버린다 - 인쇄 결과와 무관하다.
    "%CHROME%" --headless --disable-gpu --no-pdf-header-footer ^
        --print-to-pdf="%~dp0%%F.pdf" "file:///%~dp0%%F.html" 2>nul
    if exist "%%F.pdf" (
        echo     [OK] %%F.pdf
    ) else (
        echo     [실패] %%F.pdf
    )
)

echo.
echo   완료. 노란 표시가 남아 있지 않은지 눈으로 확인하세요.
echo.
pause
