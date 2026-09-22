@echo off
REM Build a single-file Windows executable into dist\ShippingMark.exe
setlocal
echo Installing build dependencies...
python -m pip install -r requirements-dev.txt || goto :error

echo Building executable...
pyinstaller --noconfirm --onefile --windowed --name ShippingMark app.py || goto :error

echo.
echo Done. See dist\ShippingMark.exe
goto :eof

:error
echo.
echo Build failed.
exit /b 1
