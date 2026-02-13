@echo off
title Open Conflict v0.10
cd /d "%~dp0"

echo.
echo   =============================================
echo        OPEN CONFLICT v0.10
echo        Terrain Analysis Toolkit
echo   =============================================
echo.

:: Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo   [ERROR] Node.js is required but not installed.
    echo.
    echo   Download it from: https://nodejs.org
    echo   Install the LTS version, then run this again.
    echo.
    pause
    exit /b 1
)

:: Show Node version
for /f "tokens=*" %%i in ('node -v') do echo   Node.js %%i detected

:: Install dependencies if needed
if not exist "node_modules" (
    echo.
    echo   First run - installing dependencies...
    echo   This takes 30-60 seconds, one time only.
    echo.
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo.
        echo   [ERROR] npm install failed. Check your internet connection.
        echo.
        pause
        exit /b 1
    )
    echo.
    echo   Dependencies installed successfully.
)

echo.
echo   Starting server...
echo   The browser will open in a few seconds.
echo   Keep this window open while using Open Conflict.
echo   Press Ctrl+C to stop the server.
echo.

:: Delay browser open so server has time to start
start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5173"

:: Start dev server (this blocks until Ctrl+C)
call npm run dev

pause
