@echo off
setlocal
cd /d "%~dp0"

echo Preparing Accessible Media Editor Build 0.10.11.
echo Git history and application source files will be preserved.

if exist "src-tauri\Cargo.lock" del /q "src-tauri\Cargo.lock"
if exist "src-tauri\target" rmdir /s /q "src-tauri\target"
if exist "dist" rmdir /s /q "dist"
if exist "node_modules" rmdir /s /q "node_modules"

echo Build preparation complete.
echo Return to GitHub Desktop and commit the changed files.
pause
