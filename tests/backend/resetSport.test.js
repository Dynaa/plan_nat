const request = require('supertest');

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

jest.mock('express-session', () => {
    return () => (req, res, next) => {
        req.session = { userId: 1, userRole: 'admin' };
        next();
    };
});

const app = require('../../server');

describe('Remise à zéro hebdomadaire par discipline (phase 4)', () => {
    let db;

    beforeAll(() => {
        const DatabaseAdapter = require('../../database');
        db = new DatabaseAdapter();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('devrait vider toutes les disciplines quand aucun sport n\'est précisé', async () => {
        db.get
            .mockResolvedValueOnce({ total: 12 }) // avant
            .mockResolvedValueOnce({ total: 0 }); // après
        db.run.mockResolvedValue({ changes: 12 });

        const res = await request(app).post('/api/admin/reset-weekly').send({});

        expect(res.status).toBe(200);
        expect(res.body.inscriptionsSupprimes).toBe(12);
        expect(res.body.sport).toBeNull();

        // Aucun filtre de sport dans la suppression.
        // (l'initialisation de la base a déjà utilisé db.run : on cible la requête)
        const suppression = db.run.mock.calls.find(c => c[0].startsWith('DELETE FROM inscriptions'));
        expect(suppression).toBeDefined();
        expect(suppression[0]).toBe('DELETE FROM inscriptions');
    });

    it('devrait ne vider que la discipline demandée', async () => {
        db.get
            .mockResolvedValueOnce({ nom: 'Vélo' }) // sport ciblé
            .mockResolvedValueOnce({ total: 2 })
            .mockResolvedValueOnce({ total: 0 });
        db.run.mockResolvedValue({ changes: 2 });

        const res = await request(app).post('/api/admin/reset-weekly').send({ sport_id: 2 });

        expect(res.status).toBe(200);
        expect(res.body.sport).toBe('Vélo');
        expect(res.body.inscriptionsSupprimes).toBe(2);
        expect(res.body.message).toContain('Vélo');

        // La suppression est bornée aux séances de ce sport
        const suppression = db.run.mock.calls.find(c => c[0].startsWith('DELETE FROM inscriptions'));
        expect(suppression).toBeDefined();
        expect(suppression[0]).toContain('WHERE seance_id IN');
        expect(suppression[0]).toContain('sport_id');
        expect(suppression[1]).toEqual([2]);
    });

    it('devrait refuser un sport inconnu sans rien supprimer', async () => {
        db.get.mockResolvedValueOnce(null);

        const res = await request(app).post('/api/admin/reset-weekly').send({ sport_id: 999 });

        expect(res.status).toBe(404);
        expect(db.run).not.toHaveBeenCalled();
    });
});
