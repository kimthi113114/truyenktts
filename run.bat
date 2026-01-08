@echo off
setlocal enabledelayedexpansion


echo --------Login into Docker--------

echo --------Login success--------

@REM :: 1. Kiểm tra Version
@REM echo -------- Bumping Version --------
@REM call node scripts/bump-version.js
@REM if %errorlevel% neq 0 (
@REM     echo [ERROR] Bumping version failed!
@REM     goto :FAILED
@REM )

:: 2. Build Docker
echo -------- Docker build --------
call docker build -t kimthi113114/truyen-ktts-v2 .
if %errorlevel% neq 0 (
    echo [ERROR] Docker build failed!
    goto :FAILED
)

:: 3. Push Docker
echo -------- Docker push --------
call docker push kimthi113114/truyen-ktts-v2
if %errorlevel% neq 0 (
    echo [ERROR] Docker push failed!
    goto :FAILED
)

echo -------- ALL SUCCESS --------
exit /b 0

:FAILED
echo -------- DEPLOY FAILED --------
:: Dừng lại để bạn xem được lỗi trước khi đóng cửa sổ
pause
exit /b 1