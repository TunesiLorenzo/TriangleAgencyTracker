@echo off
setlocal EnableExtensions

rem One-computer launcher.
rem
rem Double-click this file to run Triangle, LightRPG and the VoiceMeeter bridge
rem on this laptop. To keep tracker_config.json and team_save.json on a drive,
rem either pass the folder:
rem   run_locally.bat "G:\My Drive\Triangle Agency"
rem or set TRACKER_DATA_DIR before running this file.

if /I "%~1"=="help" (
    call "%~dp0start_lan.bat" help
    exit /b %errorlevel%
)
if /I "%~1"=="--help" (
    call "%~dp0start_lan.bat" help
    exit /b %errorlevel%
)
if /I "%~1"=="/?" (
    call "%~dp0start_lan.bat" help
    exit /b %errorlevel%
)

if not "%~1"=="" (
    call "%~dp0start_lan.bat" laptop "%~f1"
) else (
    call "%~dp0start_lan.bat" laptop
)
exit /b %errorlevel%
