import { test, expect } from '@playwright/test';

test.describe('Interface / Inscription au créneau', () => {

    test.beforeEach(async ({ page }) => {
        // ⚡ Les mocks réseau DOIVENT être enregistrés AVANT page.goto()
        await page.route('**/api/creneaux*', async route => {
            await route.fulfill({
                json: [{
                    id: 1,
                    nom: 'Natation Lundi Soir',
                    jour_semaine: 1,
                    heure_debut: '19:00',
                    heure_fin: '20:30',
                    capacite_max: 30,
                    inscrits: 5,
                    en_attente: 0,
                    statut_user: 'non_inscrit',
                    public_cible: 'les deux',
                    sport_slug: 'natation',
                    sport_nom: 'Natation',
                    sport_icone: '🏊',
                    sport_couleur: '#28A0E8'
                }, {
                    id: 2,
                    nom: 'Sortie longue',
                    jour_semaine: 0,
                    heure_debut: '09:00',
                    heure_fin: '12:00',
                    capacite_max: 25,
                    inscrits: 2,
                    en_attente: 0,
                    statut_user: 'non_inscrit',
                    public_cible: 'les deux',
                    sport_slug: 'velo',
                    sport_nom: 'Vélo',
                    sport_icone: '🚴',
                    sport_couleur: '#F59E0B'
                }]
            });
        });

        await page.route('**/api/sports', async route => {
            await route.fulfill({
                json: [
                    { id: 1, slug: 'natation', nom: 'Natation', icone: '🏊', couleur: '#28A0E8' },
                    { id: 2, slug: 'velo', nom: 'Vélo', icone: '🚴', couleur: '#F59E0B' }
                ]
            });
        });

        await page.route('**/api/mes-limites*', async route => {
            await route.fulfill({
                json: {
                    licenceType: 'Loisir/Senior',
                    maxSeances: 3,
                    seancesActuelles: 1,
                    seancesRestantes: 2,
                    limiteAtteinte: false
                }
            });
        });

        await page.route('**/api/mes-inscriptions', async route => {
            await route.fulfill({ json: [] });
        });

        await page.route('**/api/mes-meta-regles', async route => {
            await route.fulfill({ json: [] });
        });

        // Se connecter
        await page.goto('/');
        await page.fill('#login-email', 'test@playwright.com');
        await page.fill('#login-password', 'correctpassword');
        await page.click('#login-form button[type="submit"]');

        // Attendre que la page principale se charge
        await expect(page.locator('#main-section')).toBeVisible({ timeout: 8000 });
    });

    test('Le compteur de quotas affiche les séances correctement', async ({ page }) => {
        // Naviguer vers l'onglet "Mes inscriptions" qui déclenche loadMesInscriptions()
        await page.click('button[data-tab="mes-inscriptions"]');

        const quotaDetails = page.locator('#quota-details');
        await expect(quotaDetails).not.toContainText('Chargement...', { timeout: 6000 });
        await expect(quotaDetails).toContainText('1/3');
        await expect(quotaDetails).toContainText('séance(s) restante(s)');
    });

    test('Un créneau mocké s\'affiche dans la liste', async ({ page }) => {
        // Le créneau mocké doit être visible dans l'onglet créneaux (actif par défaut)
        const creneauCard = page.locator('.creneau-card').first();
        await expect(creneauCard).toBeVisible({ timeout: 6000 });
        await expect(creneauCard).toContainText('Natation Lundi Soir');
        await expect(creneauCard).toContainText('19:00 - 20:30');
    });

    test('Le filtre par sport n\'affiche que les créneaux de la discipline choisie', async ({ page }) => {
        // Les deux sports sont présents : le filtre doit être proposé
        await expect(page.locator('.sport-pill')).toHaveCount(3); // Tous + Natation + Vélo
        await expect(page.locator('.creneau-card')).toHaveCount(2);

        // Filtrer sur le vélo
        await page.click('.sport-pill[data-sport="velo"]');
        await expect(page.locator('.creneau-card')).toHaveCount(1);
        await expect(page.locator('.creneau-card').first()).toContainText('Sortie longue');

        // Filtrer sur la natation
        await page.click('.sport-pill[data-sport="natation"]');
        await expect(page.locator('.creneau-card')).toHaveCount(1);
        await expect(page.locator('.creneau-card').first()).toContainText('Natation Lundi Soir');

        // Revenir à tous les sports
        await page.click('.sport-pill[data-sport="tous"]');
        await expect(page.locator('.creneau-card')).toHaveCount(2);
    });

    test('Chaque créneau porte le badge de son sport', async ({ page }) => {
        const cartes = page.locator('.creneau-card');
        await expect(cartes.first()).toContainText('Natation');
        await expect(cartes.nth(1)).toContainText('Vélo');
    });

    test('Cliquer sur S\'inscrire envoie une requête à l\'API', async ({ page }) => {
        // Préparer le mock pour la réponse de l'inscription
        await page.route('**/api/inscriptions', async route => {
            if (route.request().method() === 'POST') {
                await route.fulfill({ json: { message: 'Inscription réussie !' }, status: 200 });
            } else {
                await route.continue();
            }
        });

        // Attendre que le bouton "S'inscrire" apparaisse
        const btnInscrire = page.locator('.creneau-card .btn-success').first();
        await expect(btnInscrire).toBeVisible({ timeout: 6000 });
        await expect(btnInscrire).toContainText(/S'inscrire/i);

        // Cliquer sur S'inscrire
        await btnInscrire.click();

        // Un message de succès doit apparaître
        const message = page.locator('#message');
        await expect(message).toBeVisible({ timeout: 5000 });
        await expect(message).toContainText(/[Ii]nscription réussie/i);
    });
});
