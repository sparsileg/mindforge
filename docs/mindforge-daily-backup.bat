@echo off
REM ================================================
REM Configuration - Edit these paths as needed
REM ================================================
set "SOURCE_DIR=C:\Users\stanb\Downloads"
set "DEST_DIR=\mnt\j\github\mindforge\docs\data"
set "FILENAME=mindforge-daily.json"
REM ================================================

REM Change to source directory
cd /d "%SOURCE_DIR%"
if errorlevel 1 (
    echo ERROR: Could not change to source directory: %SOURCE_DIR%
    pause
    exit /b 1
)

REM Check if file exists in source
if not exist "%FILENAME%" (
    echo ERROR: File %FILENAME% not found in %SOURCE_DIR%
    pause
    exit /b 1
)

REM Move file to destination (overwriting if exists)
move /Y "%SOURCE_DIR%\%FILENAME%" "%DEST_DIR%\%FILENAME%"
if errorlevel 1 (
    echo ERROR: Failed to move file to %DEST_DIR%
    pause
    exit /b 1
)

echo SUCCESS: %FILENAME% moved to %DEST_DIR%
exit /b 0
