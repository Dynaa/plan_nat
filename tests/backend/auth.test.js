const request = require('supertest');
const bcrypt = require('bcrypt');

// Mocker le module database AVANT de charger le serveur
jest.mock('../../database', () => {
    return jest.fn().mockImplementation(() => ({
        isPostgres: true,
        isTest: false,
        get: jest.fn(),
        query: jest.fn(),
        run: jest.fn(),
        adaptSQL: (sql) => sql,
    }));
});

// Charger le serveur APRÈS le mock
const app = require('../../server');
const DatabaseAdapter = require('../../database');

describe('Authentification et Routes Protégées', () => {
    let mockDbInstance;

    beforeEach(() => {
        // Récupérer l'instance mockée
        mockDbInstance = DatabaseAdapter.mock.instances[0];
        jest.clearAllMocks();
    });

    describe('POST /api/login', () => {
        it('devrait refuser une connexion avec un email inexistant', async () => {
            mockDbInstance.get.mockResolvedValueOnce(null);

            const response = await request(app)
                .post('/api/login')
                .send({ email: 'inexistant@test.com', password: 'password123' });

            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Email ou mot de passe incorrect');
        });

        it('devrait refuser une connexion avec un mauvais mot de passe', async () => {
            const hashedPassword = await bcrypt.hash('bonjour123', 10);
            mockDbInstance.get.mockResolvedValueOnce({
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

            mockDbInstance.get.mockResolvedValueOnce({
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
            expect(response.body.user.email).toBe('user@test.com');
            expect(response.headers['set-cookie']).toBeDefined();
        });
    });

    describe('Protection des routes Admin (requireAdmin middleware)', () => {
        it('devrait bloquer les appels non authentifiés avec une 401', async () => {
            const response = await request(app).get('/api/admin/users');
            expect(response.status).toBe(401);
            expect(response.body.error).toBe('Non authentifié');
        });
    });
});
