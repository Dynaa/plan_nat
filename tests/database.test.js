const DatabaseAdapter = require('../database.js');

describe('🗄️ Tests de l\'adaptateur de base de données', () => {
  let db;

  beforeEach(() => {
    // Utiliser SQLite pour les tests (plus simple)
    process.env.DATABASE_URL = '';
    db = new DatabaseAdapter();
  });

  afterEach(() => {
    if (db.db) {
      db.db.close();
    }
  });

  describe('🔄 Conversion des paramètres SQL', () => {
    test('Doit convertir ? en $1, $2, $3 pour PostgreSQL', () => {
      db.isPostgres = true;
      const sql = 'SELECT * FROM users WHERE id = ? AND email = ?';
      const converted = db.convertSQLParams(sql);
      expect(converted).toBe('SELECT * FROM users WHERE id = $1 AND email = $2');
    });

    test('Ne doit pas modifier les requêtes SQLite', () => {
      db.isPostgres = false;
      const sql = 'SELECT * FROM users WHERE id = ? AND email = ?';
      const converted = db.convertSQLParams(sql);
      expect(converted).toBe(sql);
    });

    test('Doit gérer les requêtes sans paramètres', () => {
      db.isPostgres = true;
      const sql = 'SELECT * FROM users';
      const converted = db.convertSQLParams(sql);
      expect(converted).toBe(sql);
    });
  });

  describe('🔀 Adaptation des requêtes SQL', () => {
    test('Doit retourner la requête PostgreSQL si isPostgres = true', () => {
      db.isPostgres = true;
      const sqliteSQL = 'SELECT * FROM users LIMIT 10';
      const postgresSQL = 'SELECT * FROM users LIMIT 10';
      const result = db.adaptSQL(sqliteSQL, postgresSQL);
      expect(result).toBe(postgresSQL);
    });

    test('Doit retourner la requête SQLite si isPostgres = false', () => {
      db.isPostgres = false;
      const sqliteSQL = 'INSERT OR IGNORE INTO users';
      const postgresSQL = 'INSERT INTO users ON CONFLICT DO NOTHING';
      const result = db.adaptSQL(sqliteSQL, postgresSQL);
      expect(result).toBe(sqliteSQL);
    });
  });

  describe('🔍 Détection du type de base de données', () => {
    test('Doit détecter PostgreSQL avec DATABASE_URL postgres://', () => {
      process.env.DATABASE_URL = 'postgres://user:pass@host:5432/db';
      const testDb = new DatabaseAdapter();
      expect(testDb.isPostgres).toBe(true);
    });

    test('Doit détecter PostgreSQL avec DATABASE_URL postgresql://', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';
      const testDb = new DatabaseAdapter();
      expect(testDb.isPostgres).toBe(true);
    });

    test('Doit utiliser SQLite par défaut', () => {
      delete process.env.DATABASE_URL;
      const testDb = new DatabaseAdapter();
      expect(testDb.isPostgres).toBe(false);
    });
  });
});