@echo off
rem memory-chain / tools / read-session.cmd
rem author: Jingyue (whale breaching) - 2026-10-24
rem Wrapper: find a usable node.exe (PATH first, then DSH's bundled runtime) and run read-session.mjs.
setlocal
set "NODE_EXE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%ProgramFiles%\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE_EXE (
  for /f "delims=" %%i in ('dir /b /s "%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\node.exe" 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"
)
if not defined NODE_EXE (
  echo [read-session] node.exe not found. Set NODE_EXE manually and retry.
  exit /b 1
)
"%NODE_EXE%" "%~dp0read-session.mjs" %*
exit /b %ERRORLEVEL%
