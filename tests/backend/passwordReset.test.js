const request = require('supertest');

// Mocks complets pour isoler les routes de `server.js` (même approche que email.test.js)
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

jest.mock('express-session', () => {
    return () => (req, res, next) => {
        req.session = {};
        next();
    };
});

const bcrypt = require('bcrypt');
const app = require('../../server');

describe('Mot de passe oublié', () => {
    let db;

    beforeAll(() => {
        const DatabaseAdapter = require('../../database');
        db = new DatabaseAdapter();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/forgot-password', () => {

        it('devrait rejeter une demande sans email', async () => {
            const res = await request(app)
                .post('/api/forgot-password')
                .send({});

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Email requis');
        });

        it('devrait renvoyer un message générique pour un email inconnu (anti-énumération)', async () => {
            db.get.mockResolvedValueOnce(null); // Aucun utilisateur avec cet email

            const res = await request(app)
                .post('/api/forgot-password')
                .send({ email: 'inconnu@example.com' });

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('Si un compte existe');
            // Aucun token ne doit être créé
            expect(db.run).not.toHaveBeenCalled();
        });

        it('devrait créer un token et renvoyer le même message générique pour un email connu', async () => {
            db.get.mockResolvedValueOnce({ id: 5, email: 'membre@example.com', nom: 'Dupont', prenom: 'Jean' });
            db.run.mockResolvedValue({ changes: 1 });

            const res = await request(app)
                .post('/api/forgot-password')
                .send({ email: 'membre@example.com' });

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('Si un compte existe');

            // Les anciens tokens sont invalidés puis un nouveau est inséré
            const sqlCalls = db.run.mock.calls.map(call => call[0]);
            expect(sqlCalls.some(sql => sql.includes('UPDATE password_reset_tokens SET used'))).toBe(true);
            expect(sqlCalls.some(sql => sql.includes('INSERT INTO password_reset_tokens'))).toBe(true);
        });
    });

    describe('GET /api/reset-password/info/:token', () => {

        it('devrait rejeter un token inconnu', async () => {
            db.get.mockResolvedValueOnce(null);

            const res = await request(app).get('/api/reset-password/info/token-inconnu');

            expect(res.status).toBe(400);
            expect(res.body.valid).toBe(false);
        });

        it('devrait rejeter un token expiré', async () => {
            db.get.mockResolvedValueOnce({
                expires_at: new Date(Date.now() - 60 * 1000).toISOString(), // Expiré depuis 1 min
                used: false,
                email: 'membre@example.com'
            });

            const res = await request(app).get('/api/reset-password/info/token-expire');

            expect(res.status).toBe(400);
            expect(res.body.valid).toBe(false);
        });

        it('devrait accepter un token valide', async () => {
            db.get.mockResolvedValueOnce({
                expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // Valide 1h
                used: false,
                email: 'membre@example.com'
            });

            const res = await request(app).get('/api/reset-password/info/token-valide');

            expect(res.status).toBe(200);
            expect(res.body.valid).toBe(true);
        });
    });

    describe('POST /api/reset-password', () => {

        const tokenValide = {
            id: 1,
            user_id: 5,
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            used: false
        };

        it('devrait rejeter si les mots de passe ne correspondent pas', async () => {
            const res = await request(app)
                .post('/api/reset-password')
                .send({ token: 'abc', nouveauMotDePasse: 'nouveau123', confirmerMotDePasse: 'autre456' });

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Les mots de passe ne correspondent pas');
        });

        it('devrait rejeter un mot de passe trop court', async () => {
            const res = await request(app)
                .post('/api/reset-password')
                .send({ token: 'abc', nouveauMotDePasse: 'abc', confirmerMotDePasse: 'abc' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('au moins 6 caractères');
        });

        it('devrait rejeter un token invalide', async () => {
            db.get.mockResolvedValueOnce(null);

            const res = await request(app)
                .post('/api/reset-password')
                .send({ token: 'token-inconnu', nouveauMotDePasse: 'nouveau123', confirmerMotDePasse: 'nouveau123' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('invalide ou expiré');
        });

        it('devrait rejeter un token déjà utilisé', async () => {
            db.get.mockResolvedValueOnce({ ...tokenValide, used: true });

            const res = await request(app)
                .post('/api/reset-password')
                .send({ token: 'token-use', nouveauMotDePasse: 'nouveau123', confirmerMotDePasse: 'nouveau123' });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('invalide ou expiré');
        });

        it('devrait mettre à jour le mot de passe avec un token valide et le marquer utilisé', async () => {
            db.get.mockResolvedValueOnce(tokenValide);
            db.run.mockResolvedValue({ changes: 1 });

            const res = await request(app)
                .post('/api/reset-password')
                .send({ token: 'token-valide', nouveauMotDePasse: 'nouveau123', confirmerMotDePasse: 'nouveau123' });

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('réinitialisé avec succès');

            // Le mot de passe est mis à jour (haché) pour le bon utilisateur
            const updateUserCall = db.run.mock.calls.find(call => call[0].includes('UPDATE users SET password'));
            expect(updateUserCall).toBeDefined();
            const [, params] = updateUserCall;
            expect(params[1]).toBe(5); // user_id du token
            expect(bcrypt.compareSync('nouveau123', params[0])).toBe(true);

            // Le token est marqué comme utilisé
            const markUsedCall = db.run.mock.calls.find(call => call[0].includes('UPDATE password_reset_tokens SET used'));
            expect(markUsedCall).toBeDefined();
        });
    });
});
