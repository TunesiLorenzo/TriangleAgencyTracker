@echo off
setlocal EnableExtensions

rem Triangle Agency launcher: everything on this computer.
rem
rem Double-click to start LightRPG (the room lights), the VoiceMeeter bridge and the
rem tracker, then open the viewer. run_triangleOnly.bat runs this same file without
rem LightRPG and the bridge (TRIANGLE_LIGHTS=off).
rem
rem The team, the settings and the case archive are kept in data\ beside this file.
rem To keep the tracker file (team and settings) on a drive instead, pass the folder:
rem   run_locally.bat "G:\My Drive\Triangle Agency"
rem or set TRACKER_DATA_DIR before running this file.

if /I "%~1"=="help" goto :help
if /I "%~1"=="--help" goto :help
if /I "%~1"=="/?" goto :help

if not defined PYTHON_EXE set "PYTHON_EXE=python"
set "TRACKER_DIR=%~dp0"
set "LIGHTRPG_DIR=%~dp0..\LightRPG"
set "LIGHTRPG_URL=http://127.0.0.1:5000"
if not "%~1"=="" set "TRACKER_DATA_DIR=%~f1"
set "WITH_LIGHTS=1"
if /I "%TRIANGLE_LIGHTS%"=="off" set "WITH_LIGHTS="

rem One-line ifs: a folder name with a bracket would end a bracketed block early.
if defined WITH_LIGHTS echo Triangle Agency - tracker, LightRPG and VoiceMeeter bridge
if not defined WITH_LIGHTS echo Triangle Agency - tracker only, lights off
if defined TRACKER_DATA_DIR echo   Data folder: %TRACKER_DATA_DIR%
if not defined TRACKER_DATA_DIR echo   Data folder: %TRACKER_DIR%data
echo.

call :require_python
if errorlevel 1 goto :failed

rem A tracker already running with other lights or another data folder is stopped
rem first: stopping takes LightRPG and the bridge down with it.
call :stop_other_tracker
if errorlevel 1 goto :failed

if defined WITH_LIGHTS (
    call :start_local_lights
    if errorlevel 1 goto :failed
    call :start_local_voicemeeter
    if errorlevel 1 echo WARNING: The VoiceMeeter bridge could not be started.
    rem Wait for LightRPG before the tracker starts, so the tracker's own optional
    rem auto-start does not race a second LightRPG.
    call :wait_for_lights
    if errorlevel 1 (
        echo WARNING: LightRPG did not answer within 30 seconds.
        echo          The tracker still starts; light cues may fail until LightRPG is ready.
    )
)

call :start_local_tracker
if errorlevel 1 goto :failed
call :wait_for_tracker
if errorlevel 1 (
    echo WARNING: The tracker did not answer within 30 seconds.
) else (
    start "" "http://localhost:5002/"
)
if defined WITH_LIGHTS (
    call :is_lights_running
    if not errorlevel 1 start "" "http://localhost:5000/"
)

echo.
echo Viewer:        http://%COMPUTERNAME%:5002/
echo Settings:      http://%COMPUTERNAME%:5002/settings
echo Public copy:   http://%COMPUTERNAME%:5002/public
echo Publish:       http://%COMPUTERNAME%:5002/publish
if defined WITH_LIGHTS echo Lights:        http://%COMPUTERNAME%:5000/
echo.
echo Servers that were started have their own windows. Closing this launcher is safe.
exit /b 0

rem ---------------------------------------------------------------------------

:stop_other_tracker
call :is_tracker_running
if errorlevel 1 exit /b 0
call :is_tracker_target
if not errorlevel 1 exit /b 0
echo Restarting the tracker: its lights or data folder were different...
powershell.exe -NoProfile -Command "try { $null = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:5002/api/shutdown' -TimeoutSec 3 } catch {}; for ($i = 0; $i -lt 40; $i++) { try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:5002/api/config' -TimeoutSec 1 } catch { exit 0 }; Start-Sleep -Milliseconds 500 }; exit 1" >nul 2>&1
if errorlevel 1 (
    echo ERROR: The old tracker did not stop. Close its window and run this launcher again.
    exit /b 1
)
rem It asked LightRPG to stop as it went: let that finish before starting a new one.
for /L %%G in (1,1,10) do (
    call :is_lights_running
    if errorlevel 1 exit /b 0
    timeout /t 1 /nobreak >nul 2>&1
)
exit /b 0

:start_local_voicemeeter
call :is_voicemeeter_bridge_running
if not errorlevel 1 (
    echo The VoiceMeeter bridge is already running on port 5003.
    exit /b 0
)
call :is_local_port_open 5003
if not errorlevel 1 (
    echo ERROR: Port 5003 is taken by something other than the VoiceMeeter bridge.
    exit /b 1
)
echo Starting the VoiceMeeter bridge...
start "VoiceMeeter bridge" /D "%TRACKER_DIR%" "%PYTHON_EXE%" -u voicemeeter_bridge.py --allow-origin "http://%COMPUTERNAME%:5002" --allow-origin "http://localhost:5002" --allow-origin "http://127.0.0.1:5002"
if errorlevel 1 exit /b 1
for /L %%G in (1,1,10) do (
    call :is_voicemeeter_bridge_running
    if not errorlevel 1 exit /b 0
    timeout /t 1 /nobreak >nul 2>&1
)
echo ERROR: The VoiceMeeter bridge did not answer within 10 seconds.
exit /b 1

:start_local_lights
call :is_lights_running
if not errorlevel 1 (
    echo LightRPG is already running on port 5000.
    exit /b 0
)
call :is_local_port_open 5000
if not errorlevel 1 (
    echo Port 5000 already has a listener, so another LightRPG is not started.
    exit /b 0
)
if not exist "%LIGHTRPG_DIR%\web.py" (
    echo ERROR: LightRPG was not found at:
    echo        %LIGHTRPG_DIR%
    echo Keep the LightRPG and TriangleAgencyTracker folders beside each other,
    echo or use run_triangleOnly.bat to start the tracker without lights.
    exit /b 1
)
"%PYTHON_EXE%" -c "import bleak, flask, tapo, zeroconf" >nul 2>&1
if errorlevel 1 (
    echo Installing the LightRPG Python packages...
    "%PYTHON_EXE%" -m pip install -r "%LIGHTRPG_DIR%\requirements.txt"
    if errorlevel 1 (
        echo ERROR: The LightRPG packages could not be installed.
        exit /b 1
    )
)
echo Starting LightRPG in its own window...
start "LightRPG server" /D "%LIGHTRPG_DIR%" "%PYTHON_EXE%" -u web.py
exit /b %errorlevel%

:start_local_tracker
call :is_tracker_running
if not errorlevel 1 (
    echo The tracker is already running on port 5002.
    exit /b 0
)
call :is_local_port_open 5002
if not errorlevel 1 (
    echo Port 5002 already has a listener, so another tracker is not started.
    exit /b 0
)
"%PYTHON_EXE%" -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo Installing the tracker's Python packages...
    "%PYTHON_EXE%" -m pip install -r "%TRACKER_DIR%requirements.txt"
    if errorlevel 1 (
        echo ERROR: The tracker's packages could not be installed.
        exit /b 1
    )
)
echo Starting the tracker in its own window...
start "Triangle Agency Tracker" /D "%TRACKER_DIR%" "%PYTHON_EXE%" -u serve.py --no-browser
exit /b %errorlevel%

:require_python
"%PYTHON_EXE%" --version >nul 2>&1
if not errorlevel 1 exit /b 0
echo ERROR: Python was not found as "%PYTHON_EXE%".
echo Install Python, or set PYTHON_EXE to the full path to python.exe.
exit /b 1

:is_voicemeeter_bridge_running
powershell.exe -NoProfile -Command "try { $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:5003/api/status' -TimeoutSec 2; if ($reply.service -eq $true) { exit 0 } } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

:is_lights_running
powershell.exe -NoProfile -Command "try { $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/status' -TimeoutSec 2; if ($reply.ok -eq $true) { exit 0 } } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

:is_tracker_running
powershell.exe -NoProfile -Command "try { $reply = Invoke-RestMethod -Uri 'http://127.0.0.1:5002/api/config' -TimeoutSec 2; if ($reply.ok -eq $true) { exit 0 } } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

rem The running tracker uses the lights and the data folder this launch asks for.
:is_tracker_target
powershell.exe -NoProfile -Command "try { $lights = Invoke-RestMethod -Uri 'http://127.0.0.1:5002/api/lights/status' -TimeoutSec 5; $config = Invoke-RestMethod -Uri 'http://127.0.0.1:5002/api/config' -TimeoutSec 4; $expected = if ([string]::IsNullOrWhiteSpace($env:TRACKER_DATA_DIR)) { Join-Path $env:TRACKER_DIR 'data' } else { $env:TRACKER_DATA_DIR }; $expected = [IO.Path]::GetFullPath($expected).TrimEnd('\'); $enabled = $env:TRIANGLE_LIGHTS -ne 'off'; if (($lights.url -eq $env:LIGHTRPG_URL) -and ($lights.enabled -eq $enabled) -and ($config.dataDir.TrimEnd('\') -eq $expected)) { exit 0 } } catch {}; exit 1" >nul 2>&1
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
echo Usage: %~nx0 [data-folder]
echo.
echo   Starts LightRPG, the VoiceMeeter bridge and the tracker on this computer and
echo   opens the viewer. run_triangleOnly.bat starts the tracker alone, lights off.
echo.
echo   data-folder  where the tracker file (team and settings) is kept; default data\
echo                beside this file. TRACKER_DATA_DIR does the same.
echo.
echo   Example: %~nx0 "G:\My Drive\Triangle Agency"
exit /b 0

:failed
echo.
echo The launcher stopped because of the error above.
pause
exit /b 1
