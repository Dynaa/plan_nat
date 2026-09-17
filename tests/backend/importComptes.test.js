const request = require('supertest');

// Mocks complets pour isoler les routes de `server.js` (même approche que sports.test.js)
jest.mock('../../database', () => {
    const mockDb = {
        isPostgres: true,
        get: jest.fn(),
        query: jest.fn(),
        run: jest.fn(),
        adaptSQL: jest.fn((sqlite, postgres) => postgres === undefined ? sqlite : postgres)
    };
    return jest.fn(() => mockDb);
});

jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({
        sendMail: jest.fn().mockResolvedValue({ messageId: '123' }),
        verify: jest.fn().mockResolvedValue(true)
    })),
    createTestAccount: jest.fn().mockResolvedValue({ user: 'test', pass: 'pass' })
}));

jest.mock('resend', () => ({ Resend: jest.fn() }));

// Session modifiable d'un test à l'autre (admin par défaut)
const mockSession = { userId: 1, userRole: 'admin' };
jest.mock('express-session', () => {
    return () => (req, res, next) => {
        req.session = { ...mockSession };
        next();
    };
});

const importComptes = require('../../services/importComptes');
const app = require('../../server');

describe('Import de comptes — analyse du fichier', () => {

    describe('extraireLignes', () => {

        it('reconnaît les en-têtes quelle que soit leur graphie', () => {
            const { colonnes } = importComptes.extraireLignes([
                { 'NOM': 'Dupont', 'Prénom ': 'Anne', 'Adresse e-mail': 'a@x.fr', 'Type de licence': '', 'N° licence': '123' }
            ]);

            expect(colonnes).toEqual({
                'NOM': 'nom',
                'Prénom ': 'prenom',
                'Adresse e-mail': 'email',
                'Type de licence': 'licence_type'
            });
        });

        it('écarte les lignes vides en conservant la numérotation du fichier', () => {
            const { lignes } = importComptes.extraireLignes([
                { Nom: 'Dupont', Prenom: 'Anne', Email: 'a@x.fr' },
                { Nom: '', Prenom: ' ', Email: '' },
                { Nom: 'Martin', Prenom: 'Luc', Email: 'l@x.fr' }
            ]);

            expect(lignes.map(l => l.ligne)).toEqual([2, 4]);
            expect(lignes[1]).toMatchObject({ nom: 'Martin', prenom: 'Luc', email: 'l@x.fr' });
        });
    });

    describe('normalisation', () => {

        it.each([
            ['compétition', 'Compétition'],
            ['LOISIR', 'Loisir/Senior'],
            ['Senior', 'Loisir/Senior'],
            ['junior', 'Benjamins/Junior'],
            ['', null],
            ['Triathlon', undefined]
        ])('licence « %s » → %s', (entree, attendu) => {
            expect(importComptes.normaliserLicence(entree)).toBe(attendu);
        });

        it.each([
            ['Jeunes', 'jeune'],
            ['ADULTE', 'adulte'],
            ['les deux', 'les deux'],
            ['', null],
            ['senior', undefined]
        ])('public « %s » → %s', (entree, attendu) => {
            expect(importComptes.normaliserPublic(entree)).toBe(attendu);
        });
    });

    describe('analyserLignes', () => {

        const defauts = { licence_type: 'Loisir/Senior', public_cible: 'jeune' };

        it('classe chaque ligne : nouveau, existant, doublon, erreur', () => {
            const analyse = importComptes.analyserLignes([
                { nom: 'Dupont', prenom: 'Anne', email: 'Anne@X.fr ' },
                { nom: 'Dupont', prenom: 'Anne', email: 'anne@x.fr' },
                { nom: 'Martin', prenom: 'Luc', email: 'luc@x.fr' },
                { nom: '', prenom: 'Zoé', email: 'pas-un-email' }
            ], ['luc@x.fr'], defauts);

            expect(analyse.map(l => l.statut)).toEqual(['nouveau', 'doublon', 'existant', 'erreur']);
            expect(analyse[0].email).toBe('anne@x.fr');
            expect(analyse[3].erreurs).toEqual(['Nom manquant', 'Email invalide']);
            expect(importComptes.resumer(analyse)).toEqual({ nouveau: 1, existant: 1, doublon: 1, erreur: 1 });
        });

        it('applique les valeurs par défaut quand le fichier ne précise rien', () => {
            const [ligne] = importComptes.analyserLignes(
                [{ nom: 'Dupont', prenom: 'Anne', email: 'a@x.fr' }], [], defauts
            );

            expect(ligne).toMatchObject({ licence_type: 'Loisir/Senior', public_cible: 'jeune', statut: 'nouveau' });
        });

        it('privilégie les valeurs du fichier sur les valeurs par défaut', () => {
            const [ligne] = importComptes.analyserLignes(
                [{ nom: 'Dupont', prenom: 'Anne', email: 'a@x.fr', licence_type: 'Compétition', public_cible: 'adulte' }],
                [], defauts
            );

            expect(ligne).toMatchObject({ licence_type: 'Compétition', public_cible: 'adulte' });
        });

        it('exige une licence quand ni le fichier ni les défauts n\'en donnent', () => {
            const [ligne] = importComptes.analyserLignes([{ nom: 'Dupont', prenom: 'Anne', email: 'a@x.fr' }], []);

            expect(ligne.statut).toBe('erreur');
            expect(ligne.erreurs).toEqual(['Licence à renseigner']);
            expect(ligne.public_cible).toBe('adulte');
        });

        it('signale une licence ou un public non reconnus', () => {
            const [ligne] = importComptes.analyserLignes(
                [{ nom: 'Dupont', prenom: 'Anne', email: 'a@x.fr', licence_type: 'Triathlon', public_cible: 'senior' }],
                [], defauts
            );

            expect(ligne.statut).toBe('erreur');
            expect(ligne.erreurs).toEqual(['Licence inconnue : « Triathlon »', 'Public inconnu : « senior »']);
        });
    });
});

describe('Import de comptes — routes admin', () => {
    let db;

    beforeAll(() => {
        const DatabaseAdapter = require('../../database');
        db = new DatabaseAdapter();
    });

    beforeEach(() => {
        mockSession.userId = 1;
        mockSession.userRole = 'admin';
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/admin/users/import/apercu', () => {

        it('refuse un non-administrateur', async () => {
            mockSession.userRole = 'membre';

            const res = await request(app)
                .post('/api/admin/users/import/apercu')
                .send({ lignes: [{ Nom: 'Dupont', Prénom: 'Anne', Email: 'a@x.fr' }] });

            expect(res.status).toBe(403);
            expect(res.body.error).toBe('Accès administrateur requis');
        });

        it('refuse un fichier vide', async () => {
            const res = await request(app)
                .post('/api/admin/users/import/apercu')
                .send({ lignes: [] });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Aucune ligne à importer');
        });

        it('refuse un fichier sans colonne email', async () => {
            const res = await request(app)
                .post('/api/admin/users/import/apercu')
                .send({ lignes: [{ Nom: 'Dupont', Prénom: 'Anne' }] });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('email');
        });

        it('accepte un gros export (au-delà de la limite JSON par défaut)', async () => {
            db.query.mockResolvedValueOnce([]);
            // ~200 ko : un export fédéral compte de nombreuses colonnes
            const colonnesInutiles = Object.fromEntries(
                Array.from({ length: 30 }, (_, i) => [`Colonne ${i}`, 'valeur quelconque'])
            );
            const lignes = Array.from({ length: 300 }, (_, i) => ({
                Nom: `Nom${i}`, Prénom: `Prenom${i}`, Email: `membre${i}@x.fr`, ...colonnesInutiles
            }));

            const res = await request(app)
                .post('/api/admin/users/import/apercu')
                .send({ lignes, defauts: { licence_type: 'Loisir/Senior' } });

            expect(res.status).toBe(200);
            expect(res.body.resume.nouveau).toBe(300);
        });

        it("renvoie l'analyse sans rien écrire", async () => {
            db.query.mockResolvedValueOnce([{ email: 'luc@x.fr' }]);

            const res = await request(app)
                .post('/api/admin/users/import/apercu')
                .send({
                    lignes: [
                        { Nom: 'Dupont', Prénom: 'Anne', Email: 'anne@x.fr' },
                        { Nom: 'Martin', Prénom: 'Luc', Email: 'LUC@x.fr' }
                    ],
                    defauts: { licence_type: 'Compétition', public_cible: 'jeune' }
                });

            expect(res.status).toBe(200);
            expect(res.body.resume).toEqual({ nouveau: 1, existant: 1, doublon: 0, erreur: 0 });
            expect(res.body.lignes[0]).toMatchObject({
                ligne: 2, email: 'anne@x.fr', licence_type: 'Compétition', public_cible: 'jeune'
            });
            expect(db.run).not.toHaveBeenCalled();
        });
    });

    describe('POST /api/admin/users/import', () => {

        const ligne = (email, extra = {}) => ({
            nom: 'Dupont', prenom: 'Anne', email, licence_type: 'Loisir/Senior', public_cible: 'adulte', ...extra
        });

        it('en simulation, revalide les lignes corrigées sans rien écrire', async () => {
            db.query.mockResolvedValueOnce([]);

            const res = await request(app)
                .post('/api/admin/users/import')
                .send({
                    simulation: true,
                    lignes: [ligne('a@x.fr'), ligne('b@x.fr', { licence_type: null })]
                });

            expect(res.status).toBe(200);
            expect(res.body.lignes.map(l => l.statut)).toEqual(['nouveau', 'erreur']);
            expect(db.run).not.toHaveBeenCalled();
        });

        it('crée les nouveaux comptes avec un lien de bienvenue valable 7 jours', async () => {
            db.query.mockResolvedValueOnce([]);
            db.run.mockResolvedValue({ id: 42, changes: 1 });

            const res = await request(app)
                .post('/api/admin/users/import')
                .send({ lignes: [ligne('Anne@X.fr')] });

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ crees: 1, misAJour: 0, ignores: 0, erreurs: [], emailsEnvoyes: 1 });

            const [insertSql, insertParams] = db.run.mock.calls[0];
            expect(insertSql).toContain('INSERT INTO users');
            expect(insertParams[0]).toBe('anne@x.fr');
            // Mot de passe aléatoire haché, jamais en clair
            expect(insertParams[1]).toMatch(/^\$2[aby]\$10\$/);
            expect(insertParams.slice(2)).toEqual(['Dupont', 'Anne', 'Loisir/Senior', 'adulte']);

            const [tokenSql, tokenParams] = db.run.mock.calls[1];
            expect(tokenSql).toContain('INSERT INTO password_reset_tokens');
            expect(tokenParams[1]).toBe(42);
            const joursValidite = (new Date(tokenParams[2]) - Date.now()) / 86400000;
            expect(joursValidite).toBeGreaterThan(6.9);
            expect(joursValidite).toBeLessThanOrEqual(7);
        });

        it("ne crée pas de lien quand l'envoi d'emails est désactivé", async () => {
            db.query.mockResolvedValueOnce([]);
            db.run.mockResolvedValue({ id: 42, changes: 1 });

            const res = await request(app)
                .post('/api/admin/users/import')
                .send({ lignes: [ligne('a@x.fr')], envoyerEmails: false });

            expect(res.body).toMatchObject({ crees: 1, emailsEnvoyes: 0 });
            expect(db.run).toHaveBeenCalledTimes(1);
        });

        it('ignore les comptes existants et les doublons par défaut', async () => {
            db.query.mockResolvedValueOnce([{ email: 'existant@x.fr' }]);

            const res = await request(app)
                .post('/api/admin/users/import')
                .send({ lignes: [ligne('existant@x.fr'), ligne('existant@x.fr')] });

            expect(res.body).toMatchObject({ crees: 0, misAJour: 0, ignores: 2 });
            expect(db.run).not.toHaveBeenCalled();
        });

        it('met à jour licence et public des comptes existants sur demande', async () => {
            db.query.mockResolvedValueOnce([{ email: 'existant@x.fr' }]);
            db.run.mockResolvedValue({ changes: 1 });

            const res = await request(app)
                .post('/api/admin/users/import')
                .send({
                    mettreAJourExistants: true,
                    lignes: [ligne('existant@x.fr', { licence_type: 'Compétition', public_cible: 'jeune' })]
                });

            expect(res.body).toMatchObject({ crees: 0, misAJour: 1 });
            const [sql, params] = db.run.mock.calls[0];
            expect(sql).toContain('UPDATE users SET licence_type');
            expect(params).toEqual(['Compétition', 'jeune', 'existant@x.fr']);
        });

        it('rapporte les lignes en erreur sans bloquer les autres', async () => {
            db.query.mockResolvedValueOnce([]);
            db.run.mockResolvedValue({ id: 7, changes: 1 });

            const res = await request(app)
                .post('/api/admin/users/import')
                .send({
                    envoyerEmails: false,
                    lignes: [
                        { ...ligne('invalide'), ligne: 3 },
                        { ...ligne('ok@x.fr'), ligne: 4 }
                    ]
                });

            expect(res.body.crees).toBe(1);
            expect(res.body.erreurs).toEqual([{ ligne: 3, email: 'invalide', erreurs: ['Email invalide'] }]);
        });

        it("compte comme ignoré un compte créé entre l'analyse et l'écriture", async () => {
            db.query.mockResolvedValueOnce([]);
            db.run.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));

            const res = await request(app)
                .post('/api/admin/users/import')
                .send({ lignes: [ligne('a@x.fr')] });

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ crees: 0, ignores: 1, erreurs: [], emailsEnvoyes: 0 });
        });
    });
});
