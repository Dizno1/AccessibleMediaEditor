@echo off
setlocal
cd /d "%~dp0"

echo Preparing the Accessible Media Editor recovery build.
echo Git history and application source files will be preserved.

if exist "src-tauri\Cargo.lock" del /q "src-tauri\Cargo.lock"
if exist "src-tauri\target" rmdir /s /q "src-tauri\target"
if exist "dist" rmdir /s /q "dist"
if exist "node_modules" rmdir /s /q "node_modules"

echo Recovery preparation complete.
echo Return to GitHub Desktop and commit the changed files.
pause

