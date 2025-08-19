@echo off
echo ========================================
echo   CORRECTION ERREURS PRODUCTION
echo ========================================
echo.

echo 1. Ajout des corrections...
git add .

echo 2. Commit des corrections...
git commit -m "Fix: Correction erreurs production - emails et sessions"

echo 3. Push vers GitHub...
git push origin main

echo.
echo ========================================
echo   CORRECTIONS DEPLOYEES !
echo ========================================
echo.
echo Les corrections incluent :
echo - Desactivation emails en production si pas configure
echo - Amelioration gestion sessions
echo - Meilleure gestion erreurs
echo.
echo Railway va redéployer automatiquement dans 1-2 minutes.
echo.
pause