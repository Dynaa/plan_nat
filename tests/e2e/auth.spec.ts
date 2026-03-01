import { test, expect } from '@playwright/test';

test.describe('Interface / Authentification', () => {
    // Optionnel: Avant chaque test, on pourrait réinitialiser la BDD locale
    // ou l'appeler via une route admin spéciale pour repartir à zéro.

    test('Page de connexion chargée et éléments présents', async ({ page }) => {
        // Naviguer sur l'application (le webServer la lance sur config playwright)
        await page.goto('/');

        // Vérifier le titre de la page
        await expect(page).toHaveTitle(/Créneaux Natation/i);

        // L'interface de connexion doit être visible par défaut
        const loginForm = page.locator('#login-form');
        await expect(loginForm).toBeVisible();

        // Vérifier les onglets Connexion / Inscription
        await expect(page.locator('button[data-tab="login"]')).toHaveText(/Connexion/i);
        await expect(page.locator('button[data-tab="register"]')).toHaveText(/Inscription/i);
    });

    test('Échec de la connexion affiche une erreur', async ({ page }) => {
        await page.goto('/');

        // Remplir le formulaire avec de faux identifiants
        await page.fill('#login-email', 'fake@test.com');
        await page.fill('#login-password', 'wrongpassword');

        // Soumettre
        await page.click('#login-form button[type="submit"]');

        // Vérifier qu'un message d'erreur apparait
        const messageBox = page.locator('#message');
        await expect(messageBox).toBeVisible();
        await expect(messageBox).toContainText(/incorrect/i); // /i rend insensible à la casse
        await expect(messageBox).toHaveClass(/error/);
    });

    /* 
    Test de connexion réussie :
    Il faut s'assurer qu'il existe un vrai utilisateur en base de test.
    Sera complété une fois la base test locale mise en place pour la CI.
    */
});
