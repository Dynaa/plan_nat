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
        user: 'test-user',
        pass: 'test-pass'
    })
}));

jest.mock('resend', () => {
    return {
        Resend: jest.fn().mockImplementation(() => ({
            emails: {
                send: jest.fn().mockResolvedValue({ data: { id: 'resend-123' } })
            }
        }))
    };
});

describe('Waitlist & Inscriptions Actions', () => {
    let app;
    let db;

    beforeAll(() => {
        const DatabaseAdapter = require('../../database');
        db = new DatabaseAdapter(); // Récupère le mock initialisé ci-dessus

        // Setup session mock for tests using Supertest
        // Pour by-passer requireAuth, on pourrait moquer express-session 
        // ou simplement fournir une valeur pré-programmée au middleware.
        // Puisque nous l'avons importé globalement, nous allons injecter
        // une route de mock pour lier une pseudo-session.

        app = require('../../server'); // require l'application Express mockée

        // Patching express-session or injecting middleware specifically for test is hard after creation
        // So we might simulate unauthorized unless we do a trick. Let's see route behavior.
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/inscription-attente (Token Action)', () => {
        it('devrait rejeter un token invalide ou manquant', async () => {
            const res = await request(app)
                .post('/api/inscription-attente')
                .send({}); // Pas de token

            expect(res.status).toBe(400);
            expect(res.body.error).toBe('Token manquant');
        });

        it('devrait promouvoir l\'utilisateur s\'il y a de la place', async () => {
            // Mock de `db.get` pour les différentes étapes
            db.get
                .mockResolvedValueOnce({
                    // token info
                    user_id: 1, creneau_id: 10, email: 'test@mail.com', nom: 'Doe', prenom: 'John', creneau_nom: 'Natation Lundi', capacite_max: 20
                })
                .mockResolvedValueOnce({
                    // current inscription waiting
                    user_id: 1, creneau_id: 10, statut: 'attente', position_attente: 1
                })
                .mockResolvedValueOnce({
                    // Count of inscrits actuels
                    count: 15 // 15 < 20 (capacite_max)
                });

            db.run.mockResolvedValue({ changes: 1 });

            const res = await request(app)
                .post('/api/inscription-attente')
                .send({ token: 'valid-token-123' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toContain('Inscription confirmée');

            // Vérifier que UPDATE inscriptions a bien été appelé pour inscrire
            expect(db.run).toHaveBeenCalledWith(
                expect.stringContaining("UPDATE inscriptions \n            SET statut = 'inscrit', position_attente = NULL"),
                [1, 10]
            );
        });

        it('devrait refuser l\'inscription si le créneau est redevenu complet', async () => {
            db.get
                .mockResolvedValueOnce({
                    user_id: 1, creneau_id: 10, capacite_max: 20
                })
                .mockResolvedValueOnce({
                    statut: 'attente'
                })
                .mockResolvedValueOnce({
                    count: 20 // Complet
                });

            const res = await request(app)
                .post('/api/inscription-attente')
                .send({ token: 'valid-token-123' });

            expect(res.status).toBe(409);
            expect(res.body.tooLate).toBe(true);
            expect(res.body.error).toContain('Désolé, quelqu\'un d\'autre a pris la place');
        });
    });
});
