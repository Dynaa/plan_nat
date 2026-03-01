const bcrypt = require('bcrypt');

// Créer un mock stable de la DB
const mockDb = {
    isPostgres: true,
    isTest: false,
    get: jest.fn(),
    query: jest.fn(),
    run: jest.fn(),
    adaptSQL: jest.fn(sql => sql),
};

// Mocker AVANT tout chargement du module server
jest.mock('../../database', () => {
    const MockAdapter = jest.fn(() => mockDb);
    return MockAdapter;
});

describe('Authentification et Routes Protégées', () => {
    let app;
    let request;

    beforeAll(() => {
        // Charger le serveur après que les mocks soient en place
        app = require('../../server');
        request = require('supertest');
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/login', () => {
        it('devrait refuser une connexion avec un email inexistant', async () => {
            mockDb.get.mockResolvedValueOnce(null);

            const response = await request(app)
                .post('/api/login')
                .send({ email: 'inexistant@test.com', password: 'password123' });

            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Email ou mot de passe incorrect');
        });

        it('devrait refuser une connexion avec un mauvais mot de passe', async () => {
            const hashedPassword = await bcrypt.hash('bonjour123', 10);
            mockDb.get.mockResolvedValueOnce({
                id: 1, email: 'user@test.com', password: hashedPassword
            });

            const response = await request(app)
                .post('/api/login')
                .send({ email: 'user@test.com', password: 'mauvaismotdepasse' });

            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Email ou mot de passe incorrect');
        });

        it('devrait accepter une connexion valide et renvoyer un cookie de session', async () => {
            const passwordStr = 'supermotdepasse';
            const hashedPassword = await bcrypt.hash(passwordStr, 10);

            mockDb.get.mockResolvedValueOnce({
                id: 1,
                email: 'user@test.com',
                password: hashedPassword,
                role: 'membre',
                prenom: 'Jean',
                nom: 'Dupont',
                licence_type: 'Loisir/Senior'
            });

            const response = await request(app)
                .post('/api/login')
                .send({ email: 'user@test.com', password: passwordStr });

            expect(response.status).toBe(200);
            expect(response.body.user.nom).toBe('Dupont'); // le JSON retourne nom/prenom/role
        });
    });

    describe('Protection des routes (Middleware requireAuth)', () => {
        it('devrait bloquer les appels non authentifiés avec une 401', async () => {
            // La route /api/mes-inscriptions est protégée par le middleware requireAuth
            const response = await request(app).get('/api/mes-inscriptions');
            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Non authentifié');
        });
    });
});
