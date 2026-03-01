const DatabaseAdapter = require('../../database.js');

// Mock le module pg
jest.mock('pg', () => {
    const mockQuery = jest.fn();
    return {
        Pool: jest.fn(() => ({
            query: mockQuery
        }))
    };
});

describe('DatabaseAdapter', () => {
    let db;
    let poolInstance;

    beforeEach(() => {
        // Clear mocks and env vars
        jest.clearAllMocks();
        delete process.env.DATABASE_URL;
        // Désactiver temporairement le mode test pour tester le chemin PostgreSQL
        process.env.NODE_ENV = 'development';
    });

    afterEach(() => {
        process.env.NODE_ENV = 'test'; // Restaurer après chaque test
    });

    it('devrait initialiser le pool PostgreSQL si DATABASE_URL est fournie', () => {
        process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';

        db = new DatabaseAdapter();

        const pg = require('pg');
        expect(pg.Pool).toHaveBeenCalledWith({
            connectionString: 'postgres://user:pass@localhost:5432/db',
            ssl: false // Parce que NODE_ENV !== 'production' par défaut dans jest
        });
        expect(db.pool).toBeDefined();
        expect(db.isPostgres).toBe(true);
    });

    it('devrait convertir les paramètres SQL correctement', () => {
        db = new DatabaseAdapter(); // Peu importe la DATABASE_URL pour tester la conversion pure

        const sqliteQuery = 'SELECT * FROM users WHERE id = ? AND role = ?';
        const expectedPgQuery = 'SELECT * FROM users WHERE id = $1 AND role = $2';

        const converted = db.convertSQLParams(sqliteQuery);
        expect(converted).toBe(expectedPgQuery);
    });
});
