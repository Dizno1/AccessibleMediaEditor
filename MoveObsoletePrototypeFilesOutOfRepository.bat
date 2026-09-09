@echo off
setlocal
set "PROJECT=%~dp0"
set "BACKUP=%~dp0..\AccessibleMediaEditorObsoletePrototypeBackup"

echo Moving obsolete web-prototype files out of the active repository.
echo Git history and Windows application files will not be changed.
if not exist "%BACKUP%" mkdir "%BACKUP%"

if exist "%PROJECT%app\__pycache__" move "%PROJECT%app\__pycache__" "%BACKUP%\app-python-cache" >nul
if exist "%PROJECT%data" move "%PROJECT%data" "%BACKUP%\data" >nul

echo Cleanup complete. The files remain recoverable in:
echo %BACKUP%
echo Delete this batch file before committing.
pause
