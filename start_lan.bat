@echo off
setlocal EnableExtensions

rem Triangle Agency LAN launcher
rem
rem Usage:
rem   start_lan.bat all      Start LightRPG and Triangle on this computer.
rem   start_lan.bat room     Start LightRPG here and open the tracker PC's page.
rem   start_lan.bat tracker  Start Triangle here and use LightRPG on ROOM_HOST.
rem   start_lan.bat help     Show this help without starting anything.
rem
rem With no mode, Laptop-Lorenzo uses "room"; every other computer uses
rem "tracker". Override either hostname before running the file if a computer
rem is renamed, for example:
rem   set ROOM_HOST=New-Room-Laptop
rem   set TRACKER_HOST=New-Tracker-PC
rem   start_lan.bat tracker

if not defined ROOM_HOST set "ROOM_HOST=Laptop-Lorenzo"
if not defined TRACKER_HOST set "TRACKER_HOST=DESKTOP-LORENZO"
if not defined PYTHON_EXE set "PYTHON_EXE=python"

set "TRACKER_DIR=%~dp0"
set "LIGHTRPG_DIR=%~dp0..\LightRPG"
set "MODE=%~1"

if not defined MODE (
    if /I "%COMPUTERNAME%"=="%ROOM_HOST%" (
        set "MODE=room"
    ) else (
        set "MODE=tracker"
    )
)

if /I "%MODE%"=="help" goto :help
if /I "%MODE%"=="--help" goto :help
if /I "%MODE%"=="/?" goto :help
if /I "%MODE%"=="all" goto :all
if /I "%MODE%"=="room" goto :room
if /I "%MODE%"=="tracker" goto :tracker

echo ERROR: Unknown mode "%MODE%".
echo.
goto :help_error

:all
echo Triangle Agency LAN launcher - ALL mode
echo   This computer: %COMPUTERNAME%
echo   Room hostname: %ROOM_HOST%
echo   Starting both servers locally; no LAN IP address is hardcoded.
echo.

call :require_python
if errorlevel 1 goto :failed
call :start_local_lights
if errorlevel 1 goto :failed

rem Wait for LightRPG before Triangle starts. This also stops Triangle's own
rem optional auto-start feature from racing a second LightRPG process.
call :wait_for_lights
if errorlevel 1 (
    echo WARNING: LightRPG did not answer within 30 seconds.
    echo          Triangle will still start, but light cues may fail until it is ready.
)

set "LIGHTRPG_URL=http://127.0.0.1:5000"
call :start_local_tracker
if errorlevel 1 goto :failed
call :wait_for_tracker
if errorlevel 1 (
    echo WARNING: Triangle did not answer within 30 seconds.
) else (
    start "" "http://localhost:5002/"
)

call :is_lights_running
if not errorlevel 1 start "" "http://localhost:5000/"
echo.
echo LAN viewer:  http://%COMPUTERNAME%:5002/
echo LAN settings: http://%COMPUTERNAME%:5002/settings
echo LAN lights:   http://%COMPUTERNAME%:5000/
goto :done

:room
echo Triangle Agency LAN launcher - ROOM mode
echo   Room/light computer: %COMPUTERNAME%
echo   Tracker computer:    %TRACKER_HOST%
echo.
echo This mode starts LightRPG on this computer. It opens the Triangle page on
echo %TRACKER_HOST%, but it cannot start a program on that other computer.
echo Run "start_lan.bat tracker" there first.
echo.

call :require_python
if errorlevel 1 goto :failed
call :start_local_lights
if errorlevel 1 goto :failed
call :wait_for_lights
if errorlevel 1 (
    echo WARNING: LightRPG did not answer within 30 seconds.
) else (
    start "" "http://localhost:5000/"
)

call :is_remote_tracker_running
if errorlevel 1 (
    echo WARNING: Triangle is not answering at http://%TRACKER_HOST%:5002/ yet.
    echo          The page will still open so it is ready when that server starts.
)
start "" "http://%TRACKER_HOST%:5002/"
goto :done

:tracker
echo Triangle Agency LAN launcher - TRACKER mode
echo   Tracker computer: %COMPUTERNAME%
echo   LightRPG computer: %ROOM_HOST%
echo   LightRPG address:  http://%ROOM_HOST%:5000
echo.

call :require_python
if errorlevel 1 goto :failed
set "LIGHTRPG_URL=http://%ROOM_HOST%:5000"

call :is_remote_lights_running
if errorlevel 1 (
    echo WARNING: LightRPG is not answering on %ROOM_HOST% yet.
    echo          Triangle will start normally; run "start_lan.bat room" there.
)

call :start_local_tracker
if errorlevel 1 goto :failed
call :wait_for_tracker
if errorlevel 1 (
    echo WARNING: Triangle did not answer within 30 seconds.
)
echo.
echo Other LAN devices can use http://%COMPUTERNAME%:5002/
echo The tracker browser is left closed on this server PC; use the room laptop as the viewer.
goto :done

:start_local_lights
call :is_lights_running
if not errorlevel 1 (
    echo LightRPG is already running locally on port 5000.
    exit /b 0
)
call :is_local_port_open 5000
if not errorlevel 1 (
    echo Port 5000 already has a local listener, so another LightRPG will not be started.
    echo If LightRPG is still starting, the launcher will wait for it below.
    exit /b 0
)
if not exist "%LIGHTRPG_DIR%\web.py" (
    echo ERROR: LightRPG was not found at:
    echo        %LIGHTRPG_DIR%
    echo Keep the LightRPG and TriangleAgencyTracker folders beside each other.
    exit /b 1
)
call :ensure_light_dependencies
if errorlevel 1 exit /b 1
echo Starting LightRPG in a separate window...
start "LightRPG server" /D "%LIGHTRPG_DIR%" "%PYTHON_EXE%" -u web.py
if errorlevel 1 (
    echo ERROR: Windows could not start LightRPG.
    exit /b 1
)
exit /b 0

:start_local_tracker
call :is_tracker_running
if errorlevel 1 goto :tracker_not_running
call :is_tracker_target
if not errorlevel 1 (
    echo Triangle Agency Tracker is already running locally on port 5002.
    exit /b 0
)
echo Restarting Triangle Agency Tracker because it is using the wrong LightRPG address...
powershell.exe -NoProfile -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:5002/api/shutdown' -TimeoutSec 3 ^| Out-Null } catch {}; for ($i = 0; $i -lt 20; $i++) { try { Invoke-RestMethod -Uri 'http://127.0.0.1:5002/api/config' -TimeoutSec 1 ^| Out-Null } catch { exit 0 }; Start-Sleep -Milliseconds 500 }; exit 1" >nul 2>&1
if errorlevel 1 (
    echo ERROR: The old tracker server did not stop. Close its window and run this launcher again.
    exit /b 1
)

:tracker_not_running
call :is_local_port_open 5002
if not errorlevel 1 (
    echo Port 5002 already has a local listener, so another tracker will not be started.
    echo If Triangle is still starting, the launcher will wait for it below.
    exit /b 0
)
call :ensure_tracker_dependencies
if errorlevel 1 exit /b 1
echo Starting Triangle Agency Tracker in a separate window...
start "Triangle Agency Tracker server" /D "%TRACKER_DIR%" "%PYTHON_EXE%" -u serve.py --no-browser
if errorlevel 1 (
    echo ERROR: Windows could not start Triangle Agency Tracker.
    exit /b 1
)
exit /b 0

:require_python
"%PYTHON_EXE%" --version >nul 2>&1
if not errorlevel 1 exit /b 0
echo ERROR: Python was not found as "%PYTHON_EXE%".
echo Install Python, or set PYTHON_EXE to the full path to python.exe.
exit /b 1

:ensure_light_dependencies
"%PYTHON_EXE%" -c "import bleak, flask, tapo, zeroconf" >nul 2>&1
if not errorlevel 1 exit /b 0
echo Installing the required LightRPG Python packages...
"%PYTHON_EXE%" -m pip install -r "%LIGHTRPG_DIR%\requirements.txt"
if not errorlevel 1 exit /b 0
echo ERROR: LightRPG dependencies could not be installed.
exit /b 1

:ensure_tracker_dependencies
"%PYTHON_EXE%" -c "import flask" >nul 2>&1
if not errorlevel 1 exit /b 0
echo Installing the required Triangle Agency Tracker Python packages...
"%PYTHON_EXE%" -m pip install -r "%TRACKER_DIR%requirements.txt"
if not errorlevel 1 exit /b 0
echo ERROR: Triangle Agency Tracker dependencies could not be installed.
exit /b 1

:is_lights_running
powershell.exe -NoProfile -Command "try { $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/status' -TimeoutSec 2; if ($reply.ok -eq $true) { exit 0 } } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

:is_tracker_running
powershell.exe -NoProfile -Command "try { $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:5002/api/config' -TimeoutSec 2; if ($reply.ok -eq $true) { exit 0 } } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

:is_tracker_target
powershell.exe -NoProfile -Command "try { $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:5002/api/lights/status' -TimeoutSec 4; if ($reply.url -eq '%LIGHTRPG_URL%') { exit 0 } } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

:is_remote_lights_running
powershell.exe -NoProfile -Command "try { $reply = Invoke-RestMethod -Uri 'http://%ROOM_HOST%:5000/api/status' -TimeoutSec 3; if ($reply.ok -eq $true) { exit 0 } } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

:is_remote_tracker_running
powershell.exe -NoProfile -Command "try { $reply = Invoke-RestMethod -Uri 'http://%TRACKER_HOST%:5002/api/config' -TimeoutSec 3; if ($reply.ok -eq $true) { exit 0 } } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

:is_local_port_open
powershell.exe -NoProfile -Command "$client = New-Object System.Net.Sockets.TcpClient; try { $connected = $client.ConnectAsync('127.0.0.1', %~1).Wait(750); if ($connected -and $client.Connected) { exit 0 } } catch {} finally { $client.Dispose() }; exit 1" >nul 2>&1
exit /b %errorlevel%

:wait_for_lights
for /L %%G in (1,1,30) do (
    call :is_lights_running
    if not errorlevel 1 exit /b 0
    timeout /t 1 /nobreak >nul 2>&1
)
exit /b 1

:wait_for_tracker
for /L %%G in (1,1,30) do (
    call :is_tracker_running
    if not errorlevel 1 exit /b 0
    timeout /t 1 /nobreak >nul 2>&1
)
exit /b 1

:help
echo Triangle Agency LAN launcher
echo.
echo Usage: %~nx0 [all^|room^|tracker^|help]
echo.
echo   all      Start LightRPG and Triangle locally, then open both pages.
echo   room     Start LightRPG locally and open Triangle on TRACKER_HOST.
echo   tracker  Start Triangle locally, using LightRPG on ROOM_HOST.
echo.
echo Defaults:
echo   ROOM_HOST=%ROOM_HOST%
echo   TRACKER_HOST=%TRACKER_HOST%
echo   No mode = room on ROOM_HOST; tracker on every other computer.
echo.
echo Hostnames are resolved by Windows, so DHCP address changes need no edits.
exit /b 0

:help_error
call :help
exit /b 2

:failed
echo.
echo The launcher stopped because of the error above.
pause
exit /b 1

:done
echo.
echo Servers that were started have their own windows. Closing this launcher is safe.
exit /b 0
