@echo off
cd /d "%~dp0"
python -c "import flask" 2>nul || python -m pip install -r requirements.txt
python serve.py
pause
