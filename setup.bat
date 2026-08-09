@echo off
REM ============================================================================
REM  setup.bat - one double-click to view the colour-coded gas map LOCALLY.
REM
REM  It (1) builds colour-by-pressure layers (HP/IP/MP/LP) from whatever GeoJSON
REM  you have put in local\source\, then (2) serves the map on your machine and
REM  opens it in your browser.
REM
REM  Everything it writes stays under local\, which is git-ignored - so nothing
REM  here is ever committed or published. This is a LOCAL viewer, not a
REM  publisher. It does not download or decrypt anything; you supply the GeoJSON.
REM
REM  Needs Node and Python on PATH (the repo already uses both).
REM ============================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul || (echo [x] Node.js not found on PATH. Install it, then re-run. & pause & exit /b 1)
where python >nul 2>nul || (echo [x] Python not found on PATH. Install it, then re-run. & pause & exit /b 1)

echo.
echo === Building local colour-coded gas layers ===
node build_gas_local.mjs
if errorlevel 1 (echo [x] build failed. & pause & exit /b 1)

echo.
echo === Serving on http://localhost:8000  (close this window to stop) ===
REM open the browser a moment after the server starts
start "" cmd /c "timeout /t 2 >nul & start "" http://localhost:8000/index.html"
python -m http.server 8000

endlocal
