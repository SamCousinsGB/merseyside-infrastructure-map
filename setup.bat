@echo off
REM ============================================================================
REM  setup.bat - one double-click to view the colour-coded gas map LOCALLY.
REM
REM  It (1) extracts MAPS Viewer .mvf tiles to GeoJSON, if local\mvf.config.json
REM  points at a copy, (2) builds colour-by-pressure layers (HP/IP/MP/LP) from
REM  whatever is then in local\source\, and (3) serves the map on your machine
REM  and opens it in your browser.
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
echo === Extracting MAPS Viewer tiles (skipped if not configured) ===
node build_maps_mvf.mjs
if errorlevel 1 (echo [x] MVF extraction failed. & pause & exit /b 1)

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
