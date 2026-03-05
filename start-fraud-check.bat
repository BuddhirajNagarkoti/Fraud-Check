2@echo off
TITLE Fraud Check Application Status Output
echo =======================================================
echo          FRAUD CHECK PLATFORM DEPLOYMENT
echo =======================================================
echo.

echo [1/3] Starting backend server (port 8002)...
start "Backend API Service" cmd /c "cd backend && npm install && npm run dev"

echo [2/3] Waiting for backend to initialize (3 seconds)...
timeout /t 3 /nobreak >nul
echo Backend initializing phase complete.
echo.

echo [3/3] Starting frontend Vite server...
start "Frontend Node Service" cmd /c "cd frontend && npm install && npm run dev"

echo Complete! Opening application in browser...
timeout /t 5 /nobreak >nul
start http://localhost:5173

echo.
echo Both servers are now running in background windows.
echo To turn them off, just close the two terminal windows.
pause
