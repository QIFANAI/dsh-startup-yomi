@echo off
rem Run tests, public checks, then reproduce and compare the release package.
setlocal
set "ROOT=%~dp0.."
pushd "%ROOT%"
call npm test
if errorlevel 1 goto fail
call node scripts\check-public.mjs
if errorlevel 1 goto fail
call node scripts\build-release.mjs --mode source --verify-manifest
if errorlevel 1 goto fail
popd
echo.
echo [OK] tests, public checks, and release reproduction passed
exit /b 0
:fail
popd
echo.
echo [X] verification failed
exit /b 1
