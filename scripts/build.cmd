@echo off
rem Build a reproducible source tarball into ..\releases
rem Usage: scripts\build.cmd
setlocal
set "ROOT=%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo [X] node not found in PATH. Install Node.js 20+ first.
  exit /b 1
)
pushd "%ROOT%"
node scripts\build-release.mjs --mode source
set "CODE=%errorlevel%"
popd
if not "%CODE%"=="0" (
  echo [X] build failed
  exit /b %CODE%
)
echo.
echo [OK] source tarball written to %ROOT%\releases
echo Next: fully quit DeepSeek Harness, then
echo   dsh plugin --profile desktop add "%ROOT%\releases\dsh-startup-yomi-<version>.tgz"
