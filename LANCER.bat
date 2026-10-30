@echo off
title Prospecteur
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe : https://nodejs.org
  pause
  exit /b
)

rem Demarre l'outil en arriere-plan, sans fenetre. S'il tourne deja, cette commande ne fait rien.
wscript //nologo "%~dp0arriere-plan.vbs"

rem Attend que l'outil reponde (10 secondes max), puis ouvre la page.
powershell -NoProfile -Command "for ($i = 0; $i -lt 40; $i++) { try { Invoke-WebRequest http://127.0.0.1:4321/api/ping -UseBasicParsing -TimeoutSec 1 | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 250 } }; exit 1"
if errorlevel 1 (
  echo L'outil n'a pas demarre. Regarde le fichier donnees\journal.log pour voir l'erreur.
  pause
  exit /b
)

rem Ouvre l'outil dans le navigateur par defaut.
start "" http://localhost:4321
