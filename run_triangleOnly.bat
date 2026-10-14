@echo off
setlocal EnableExtensions

rem Triangle Agency launcher: the tracker alone.
rem
rem The same as run_locally.bat, without LightRPG and the VoiceMeeter bridge. The lights
rem are off in the tracker too: no cues are sent, and Log Out leaves LightRPG alone.
rem Takes the same optional data folder:
rem   run_triangleOnly.bat "G:\My Drive\Triangle Agency"

set "TRIANGLE_LIGHTS=off"
rem "call x.bat /?" would show CALL's own help instead.
if "%~1"=="/?" (
    call "%~dp0run_locally.bat" help
) else (
    call "%~dp0run_locally.bat" %*
)
exit /b %errorlevel%
