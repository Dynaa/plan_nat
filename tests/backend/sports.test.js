const request = require('supertest');

// Mocks complets pour isoler les routes de `server.js`
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

// Session admin : les routes de création de créneau sont protégées par requireAdmin
jest.mock('express-session', () => {
    return () => (req, res, next) => {
        req.session = { userId: 1, userRole: 'admin' };
        next();
    };
});

const app = require('../../server');

describe('Multi-sports (phase 0)', () => {
    let db;

    beforeAll(() => {
        const DatabaseAdapter = require('../../database');
        db = new DatabaseAdapter();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/sports', () => {

        it('devrait renvoyer les sports actifs', async () => {
            db.query.mockResolvedValueOnce([
                { id: 1, slug: 'natation', nom: 'Natation', icone: '🏊', couleur: '#28A0E8' },
                { id: 2, slug: 'velo', nom: 'Vélo', icone: '🚴', couleur: '#F59E0B' }
            ]);

            const res = await request(app).get('/api/sports');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2);
            expect(res.body[0].slug).toBe('natation');
        });

        it('devrait renvoyer une erreur 500 si la base est indisponible', async () => {
            db.query.mockRejectedValueOnce(new Error('DB down'));

            const res = await request(app).get('/api/sports');

            expect(res.status).toBe(500);
        });
    });

    describe('POST /api/creneaux — rattachement au sport', () => {

        const creneauValide = {
            nom: 'Lundi Matin 7h-8h',
            jour_semaine: 1,
            heure_debut: '07:00',
            heure_fin: '08:00',
            nombre_lignes: 2,
            personnes_par_ligne: 6
        };

        it('devrait rattacher le créneau à la natation quand aucun sport n\'est fourni', async () => {
            db.get.mockResolvedValueOnce({ id: 1 }); // lookup du sport natation
            db.run.mockResolvedValueOnce({ lastID: 42 });

            const res = await request(app).post('/api/creneaux').send(creneauValide);

            expect(res.status).toBe(200);

            // Le sport_id inséré est celui de la natation (2e paramètre de l'INSERT)
            const [sql, params] = db.run.mock.calls[0];
            expect(sql).toContain('sport_id');
            expect(params[1]).toBe(1);
        });

        it('devrait respecter le sport explicitement fourni', async () => {
            db.run.mockResolvedValueOnce({ lastID: 43 });

            const res = await request(app)
                .post('/api/creneaux')
                .send({ ...creneauValide, sport_id: 3 });

            expect(res.status).toBe(200);

            const [, params] = db.run.mock.calls[0];
            expect(params[1]).toBe(3);
            // Aucun lookup de la natation n'est nécessaire dans ce cas
            expect(db.get).not.toHaveBeenCalled();
        });

        it('devrait toujours rejeter un créneau incomplet', async () => {
            const res = await request(app)
                .post('/api/creneaux')
                .send({ nom: 'Incomplet' });

            expect(res.status).toBe(400);
        });
    });
});
