@echo off
title OpenGemini — Local & BYOK AI Workspace
cd /d "%~dp0"
echo Starting OpenGemini on http://localhost:3456 ...
start "" "http://localhost:3456"
node server/index.js
pause
