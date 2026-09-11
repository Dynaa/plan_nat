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

    describe('POST /api/creneaux — capacité', () => {

        const base = {
            nom: 'Créneau',
            jour_semaine: 1,
            heure_debut: '07:00',
            heure_fin: '08:00'
        };

        it('devrait déduire la capacité des lignes d\'eau (natation)', async () => {
            db.get.mockResolvedValueOnce({ id: 1 });
            db.run.mockResolvedValueOnce({ lastID: 1 });

            const res = await request(app)
                .post('/api/creneaux')
                .send({ ...base, nombre_lignes: 3, personnes_par_ligne: 8 });

            expect(res.status).toBe(200);
            const [, params] = db.run.mock.calls[0];
            expect(params[7]).toBe(24); // capacite_max = 3 × 8
        });

        it('devrait accepter une capacité directe sans lignes d\'eau (autres sports)', async () => {
            db.run.mockResolvedValueOnce({ lastID: 2 });

            const res = await request(app)
                .post('/api/creneaux')
                .send({ ...base, sport_id: 3, capacite_max: 30 });

            expect(res.status).toBe(200);
            const [, params] = db.run.mock.calls[0];
            expect(params[7]).toBe(30);
            // Les lignes d'eau restent vides pour un sport qui n'en a pas
            expect(params[5]).toBeNull();
            expect(params[6]).toBeNull();
        });

        it('devrait rejeter un créneau sans aucune forme de capacité', async () => {
            const res = await request(app).post('/api/creneaux').send(base);

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('capacité');
        });

        it('devrait accepter le dimanche (jour_semaine = 0)', async () => {
            db.run.mockResolvedValueOnce({ lastID: 3 });

            const res = await request(app)
                .post('/api/creneaux')
                .send({ ...base, jour_semaine: 0, sport_id: 2, capacite_max: 25 });

            expect(res.status).toBe(200);
        });

        it('devrait retomber sur la capacité par défaut du sport si elle n\'est pas saisie', async () => {
            db.get.mockResolvedValueOnce({ capacite_defaut: 50 }); // capacité du sport
            db.run.mockResolvedValueOnce({ lastID: 4 });

            const res = await request(app)
                .post('/api/creneaux')
                .send({ ...base, sport_id: 2 });

            expect(res.status).toBe(200);
            const [, params] = db.run.mock.calls[0];
            expect(params[7]).toBe(50);
        });

        it('devrait préférer la capacité saisie à celle par défaut', async () => {
            db.run.mockResolvedValueOnce({ lastID: 5 });

            const res = await request(app)
                .post('/api/creneaux')
                .send({ ...base, sport_id: 2, capacite_max: 12 });

            expect(res.status).toBe(200);
            const [, params] = db.run.mock.calls[0];
            expect(params[7]).toBe(12);
            // La capacité par défaut du sport n'est même pas consultée
            expect(db.get).not.toHaveBeenCalled();
        });

        it('devrait rejeter un créneau de natation sans lignes d\'eau (aucune capacité par défaut)', async () => {
            db.get.mockResolvedValueOnce({ capacite_defaut: null }); // la natation n'en a pas

            const res = await request(app)
                .post('/api/creneaux')
                .send({ ...base, sport_id: 1 });

            expect(res.status).toBe(400);
            expect(res.body.error).toContain('capacité');
        });

        it('devrait accepter un créneau sans limite même sans capacité résolue', async () => {
            db.get.mockResolvedValueOnce({ capacite_defaut: null });
            db.run.mockResolvedValueOnce({ lastID: 6 });

            const res = await request(app)
                .post('/api/creneaux')
                .send({ ...base, sport_id: 2, sans_limite: true });

            expect(res.status).toBe(200);
            const [, params] = db.run.mock.calls[0];
            expect(params[8]).toBe(true); // sans_limite
        });
    });

    describe('PUT /api/creneaux/:id — changement de sport', () => {

        const modif = {
            nom: 'Créneau modifié',
            jour_semaine: 1,
            heure_debut: '07:00',
            heure_fin: '08:00'
        };

        it('devrait changer le sport et retirer le créneau de son bloc', async () => {
            db.get
                .mockResolvedValueOnce({ sport_id: 1 })        // créneau existant (natation)
                .mockResolvedValueOnce({ capacite_defaut: 50 }) // capacité par défaut du nouveau sport
                .mockResolvedValueOnce({ slug: 'course' });     // sport après mise à jour
            db.run
                .mockResolvedValueOnce({ changes: 1 })  // UPDATE creneaux
                .mockResolvedValueOnce({ changes: 1 }); // DELETE bloc_creneaux

            const res = await request(app)
                .put('/api/creneaux/3')
                .send({ ...modif, sport_id: 3 });

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('retiré de son bloc');

            const sqlAppels = db.run.mock.calls.map(c => c[0]);
            expect(sqlAppels.some(sql => sql.includes('DELETE FROM bloc_creneaux'))).toBe(true);
        });

        it('devrait laisser le bloc intact si le créneau reste en natation', async () => {
            // Les lignes d'eau suffisent : la capacité par défaut du sport n'est pas consultée
            db.get.mockResolvedValueOnce({ sport_id: 1 });
            db.run.mockResolvedValueOnce({ changes: 1 });

            const res = await request(app)
                .put('/api/creneaux/3')
                .send({ ...modif, sport_id: 1, nombre_lignes: 2, personnes_par_ligne: 6 });

            expect(res.status).toBe(200);
            expect(res.body.message).not.toContain('retiré de son bloc');

            const sqlAppels = db.run.mock.calls.map(c => c[0]);
            expect(sqlAppels.some(sql => sql.includes('DELETE FROM bloc_creneaux'))).toBe(false);
        });

        it('devrait renvoyer 404 pour un créneau inexistant', async () => {
            db.get.mockResolvedValueOnce(null);

            const res = await request(app).put('/api/creneaux/999').send(modif);

            expect(res.status).toBe(404);
        });
    });
});
