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

describe('Promotion automatique de la liste d\'attente', () => {
    let db;

    const modif = {
        nom: 'Renfo',
        sport_id: 4,
        jour_semaine: 3,
        heure_debut: '20:00',
        heure_fin: '21:00'
    };

    const dateFuture = () => {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        return d.toISOString().split('T')[0];
    };

    beforeAll(() => {
        const DatabaseAdapter = require('../../database');
        db = new DatabaseAdapter();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('devrait promouvoir autant de personnes que de places gagnées', async () => {
        const jour = dateFuture();

        // Le sport ne change pas et la capacité est fournie : ni contrôle de sport,
        // ni lecture de la capacité par défaut.
        db.get
            .mockResolvedValueOnce({ sport_id: 4, capacite_max: 2, sans_limite: false }) // état avant
            .mockResolvedValueOnce({ nom: 'Renfo', capacite_max: 4, sans_limite: false }) // relecture pour la promotion
            .mockResolvedValueOnce({ total: 2 });                                         // inscrits sur la date
        db.query
            .mockResolvedValueOnce([{ date_seance: jour }])                               // dates en attente
            .mockResolvedValueOnce([{ user_id: 10 }, { user_id: 11 }, { user_id: 12 }]);  // file d'attente
        db.run.mockResolvedValue({ changes: 1 });

        const res = await request(app)
            .put('/api/creneaux/22')
            .send({ ...modif, capacite_max: 4 });

        expect(res.status).toBe(200);
        // 4 places - 2 inscrits = 2 promotions, la troisième personne reste en attente
        expect(res.body.promus).toBe(2);

        const promotions = db.run.mock.calls.filter(c => c[0].includes(`SET statut = 'inscrit'`));
        expect(promotions).toHaveLength(2);
        expect(promotions[0][1]).toContain(10);
        expect(promotions[1][1]).toContain(11);

        // La personne restante est renumérotée en position 1
        const renumerotations = db.run.mock.calls.filter(c => c[0].includes('SET position_attente'));
        expect(renumerotations).toHaveLength(1);
        expect(renumerotations[0][1]).toEqual([1, '22', 12, jour]);
    });

    it('devrait promouvoir toute la liste quand le créneau passe sans limite', async () => {
        const jour = dateFuture();

        // Sans capacité saisie, celle par défaut du sport est consultée
        db.get
            .mockResolvedValueOnce({ sport_id: 4, capacite_max: 2, sans_limite: false })
            .mockResolvedValueOnce({ capacite_defaut: 20 })
            .mockResolvedValueOnce({ nom: 'Renfo', capacite_max: 20, sans_limite: true })
            .mockResolvedValueOnce({ total: 2 });
        db.query
            .mockResolvedValueOnce([{ date_seance: jour }])
            .mockResolvedValueOnce([{ user_id: 10 }, { user_id: 11 }, { user_id: 12 }]);
        db.run.mockResolvedValue({ changes: 1 });

        const res = await request(app)
            .put('/api/creneaux/22')
            .send({ ...modif, sans_limite: true });

        expect(res.status).toBe(200);
        expect(res.body.promus).toBe(3);

        // Plus personne en attente : aucune renumérotation
        const renumerotations = db.run.mock.calls.filter(c => c[0].includes('SET position_attente'));
        expect(renumerotations).toHaveLength(0);
    });

    it('ne devrait promouvoir personne si la capacité ne change pas', async () => {
        db.get.mockResolvedValueOnce({ sport_id: 4, capacite_max: 4, sans_limite: false });
        db.run.mockResolvedValue({ changes: 1 });

        const res = await request(app)
            .put('/api/creneaux/22')
            .send({ ...modif, capacite_max: 4 });

        expect(res.status).toBe(200);
        expect(res.body.promus).toBe(0);
        // La liste d'attente n'est même pas consultée
        expect(db.query).not.toHaveBeenCalled();
    });

    it('ne devrait pas repromouvoir un créneau déjà sans limite', async () => {
        db.get.mockResolvedValueOnce({ sport_id: 4, capacite_max: 2, sans_limite: true });
        db.run.mockResolvedValue({ changes: 1 });

        const res = await request(app)
            .put('/api/creneaux/22')
            .send({ ...modif, sans_limite: true, capacite_max: 2 });

        expect(res.status).toBe(200);
        expect(res.body.promus).toBe(0);
        expect(db.query).not.toHaveBeenCalled();
    });

    it('ne devrait promouvoir personne quand la capacité baisse', async () => {
        db.get.mockResolvedValueOnce({ sport_id: 4, capacite_max: 10, sans_limite: false });
        db.run.mockResolvedValue({ changes: 1 });

        const res = await request(app)
            .put('/api/creneaux/22')
            .send({ ...modif, capacite_max: 4 });

        expect(res.status).toBe(200);
        expect(res.body.promus).toBe(0);
    });
});
