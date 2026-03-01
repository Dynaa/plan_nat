const request = require('supertest');

// Mocks complets pour isoler les routes de `server.js`
jest.mock('../../database', () => {
    const mockDb = {
        isPostgres: true,
        get: jest.fn(),
        query: jest.fn(),
        run: jest.fn()
    };
    return jest.fn(() => mockDb);
});

jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({
        sendMail: jest.fn().mockResolvedValue({ messageId: '123' }),
        verify: jest.fn().mockResolvedValue(true)
    })),
    createTestAccount: jest.fn().mockResolvedValue({
        user: 'test',
        pass: 'pass'
    })
}));

jest.mock('resend', () => ({ Resend: jest.fn() }));

// Pour tester l'email, on mock express-session
// En mockant le module req.session dans server ou en ajoutant un jwt
// Plutot complexe de mocker une session après initialisation dans server.js.
// On va donc utiliser une approche avec un simple mock HTTP ou s'appuyer sur
// le fait que req.session.userId doit être actif.

// Créer un mock middleware pour requireAuth
jest.mock('express-session', () => {
    return () => (req, res, next) => {
        // Pseudo session active
        req.session = { userId: 5, userRole: 'user' };
        next();
    };
});

const app = require('../../server'); // require l'application Express mockée

describe('Email Validation & Profil Actions', () => {
    let db;

    beforeAll(() => {
        const DatabaseAdapter = require('../../database');
        db = new DatabaseAdapter();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('PUT /api/mon-profil', () => {

        it('devrait rejeter un profil si l\'email est de format invalide', async () => {
            const res = await request(app)
                .put('/api/mon-profil')
                .send({
                    nom: 'Dupont',
                    prenom: 'Jean',
                    email: 'jean.dupont@missing-tld' // Email invalide
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Format d\'email invalide');
        });

        it('devrait accepter un email valide et mettre à jour le profil', async () => {
            // Check existing user query mocking
            db.get.mockResolvedValueOnce(null); // Pas d'utilisateur avec cet email
            db.run.mockResolvedValueOnce({ changes: 1 }); // OK mise à jour

            const res = await request(app)
                .put('/api/mon-profil')
                .send({
                    nom: 'Dupont',
                    prenom: 'Jean',
                    email: 'jean.dupont@example.com' // Email valide
                });

            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Profil modifié avec succès');
        });

        it('devrait rejeter si l\'email est déjà utilisé par un autre utilisateur', async () => {
            db.get.mockResolvedValueOnce({ id: 10 }); // Un autre utilisateur (id 10) a déjà cet email

            const res = await request(app)
                .put('/api/mon-profil')
                .send({
                    nom: 'Dupont',
                    prenom: 'Jean',
                    email: 'taken@example.com'
                });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('Cet email est déjà utilisé');
        });
    });
});
