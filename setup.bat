@echo off
REM ============================================================================
REM  setup.bat - one double-click to open the production map locally.
REM
REM  The committed data is already browser-ready. Normal startup performs no
REM  extraction or build: it starts the server and opens the page. Pass
REM  --rebuild only after changing the committed GeoJSON tile sources.
REM ============================================================================
setlocal
cd /d "%~dp0"

where python >nul 2>nul || (echo [x] Python not found on PATH. Install it, then re-run. & pause & exit /b 1)

if /I "%~1"=="--rebuild" (
  where node >nul 2>nul || (echo [x] Node.js not found on PATH. Install it, then re-run. & pause & exit /b 1)
  echo.
  echo === Rebuilding protobuf vector tiles ===
  call npm install
  if errorlevel 1 (echo [x] npm install failed. & pause & exit /b 1)
  call npm run build-mvt
  if errorlevel 1 (echo [x] vector-tile build failed. & pause & exit /b 1)
)

echo.
echo === Serving on http://localhost:8000  (close this window to stop) ===
REM open the browser a moment after the server starts
start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:8000/"
python -m http.server 8000

endlocal
