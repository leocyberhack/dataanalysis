@echo off
setlocal

cd /d "%~dp0"
set "PYTHON_EXE=%CD%\.venv\Scripts\python.exe"
set "API_PORT=8001"

if not exist "%PYTHON_EXE%" (
  echo [ERROR] Virtual environment not found.
  echo Expected: "%PYTHON_EXE%"
  echo Create it first, then install dependencies.
  pause
  exit /b 1
)

echo ----------------------------------------------------
echo [1/2] Starting FastAPI backend on port %API_PORT%...
start /B "" cmd /c "set PORT=%API_PORT%&& ""%PYTHON_EXE%"" backend\main.py"

echo [2/2] Starting React frontend on port 5173...
echo ----------------------------------------------------
echo API:  http://127.0.0.1:%API_PORT%
echo Web:  http://localhost:5173
echo.

cd frontend
set "VITE_API_URL=http://127.0.0.1:%API_PORT%"
call npm.cmd run dev
