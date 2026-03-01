// Adaptateur de base de données PostgreSQL
const { Pool } = require('pg');

class DatabaseAdapter {
    constructor() {
        this.isPostgres = true; // Always return true so `server.js` doesn't crash on sqlite branch

        if (!process.env.DATABASE_URL) {
            console.error('❌ DATABASE_URL non définie, configuration DB échouée.');
            // En cas d'absence, le pool crashera s'il est interrogé.
        }

        console.log('🐘 Initialisation du pool PostgreSQL...');
        this.pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
    }

    // Convert keys ? into $1, $2, etc for pg format if called with sqlite-style params
    convertSQLParams(sql) {
        let paramIndex = 1;
        return sql.replace(/\?/g, () => `$${paramIndex++}`);
    }

    // Méthode unifiée pour exécuter des requêtes et récupérer des lignes
    async query(sql, params = []) {
        const convertedSQL = this.convertSQLParams(sql);
        const result = await this.pool.query(convertedSQL, params);
        return result.rows;
    }

    // Méthode pour une seule ligne
    async get(sql, params = []) {
        const convertedSQL = this.convertSQLParams(sql);
        const result = await this.pool.query(convertedSQL, params);
        return result.rows[0] || null;
    }

    // Méthode pour exécuter (INSERT, UPDATE, DELETE)
    async run(sql, params = []) {
        const convertedSQL = this.convertSQLParams(sql);
        const result = await this.pool.query(convertedSQL, params);
        return {
            lastID: result.insertId || null,
            changes: result.rowCount || 0
        };
    }

    // Méthode pour les transactions
    serialize(callback) {
        callback();
    }
}

module.exports = DatabaseAdapter;