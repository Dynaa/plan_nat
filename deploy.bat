@echo off
echo ========================================
echo   DEPLOIEMENT GESTION CRENEAUX NATATION
echo ========================================
echo.

echo 1. Verification de Git...
git --version >nul 2>&1
if errorlevel 1 (
    echo ERREUR: Git n'est pas installe ou pas dans le PATH
    pause
    exit /b 1
)

echo 2. Ajout des fichiers...
git add .

echo 3. Commit des changements...
set /p message="Message de commit (ou Entree pour 'Mise a jour'): "
if "%message%"=="" set message=Mise a jour
git commit -m "%message%"

echo 4. Push vers GitHub...
git push origin main

echo.
echo ========================================
echo   DEPLOIEMENT TERMINE !
echo ========================================
echo.
echo Prochaines etapes :
echo 1. Aller sur railway.app
echo 2. Le deploiement se fait automatiquement
echo 3. Configurer votre domaine OVH si pas encore fait
echo.
echo Voir DEPLOY_GUIDE.md pour les details
echo.
pause