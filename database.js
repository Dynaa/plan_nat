// Adaptateur de base de données (SQLite ou PostgreSQL)
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');

class DatabaseAdapter {
    constructor() {
        // Détection PostgreSQL plus robuste
        this.isPostgres = !!process.env.DATABASE_URL && 
                         (process.env.DATABASE_URL.startsWith('postgres') || 
                          process.env.DATABASE_URL.startsWith('postgresql'));
        
        console.log('🔍 DATABASE_URL détectée:', !!process.env.DATABASE_URL);
        console.log('🔍 Type de base:', this.isPostgres ? 'PostgreSQL' : 'SQLite');
        
        if (this.isPostgres) {
            console.log('🐘 Utilisation de PostgreSQL');
            console.log('🔗 URL de connexion:', process.env.DATABASE_URL ? 'Configurée' : 'Manquante');
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });
        } else {
            console.log('📁 Utilisation de SQLite');
            const dbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH ? 
                `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/natation.db` : './natation.db';
            this.db = new sqlite3.Database(dbPath);
        }
    }

    // Méthode unifiée pour exécuter des requêtes
    async query(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isPostgres) {
                // Convertir les ? en $1, $2, $3 pour PostgreSQL
                const convertedSQL = this.convertSQLParams(sql);
                this.pool.query(convertedSQL, params, (err, result) => {
                    if (err) reject(err);
                    else resolve(result.rows);
                });
            } else {
                this.db.all(sql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            }
        });
    }

    // Méthode pour une seule ligne
    async get(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isPostgres) {
                // Convertir les ? en $1, $2, $3 pour PostgreSQL
                const convertedSQL = this.convertSQLParams(sql);
                this.pool.query(convertedSQL, params, (err, result) => {
                    if (err) reject(err);
                    else resolve(result.rows[0] || null);
                });
            } else {
                this.db.get(sql, params, (err, row) => {
                    if (err) reject(err);
                    else resolve(row || null);
                });
            }
        });
    }

    // Méthode pour exécuter (INSERT, UPDATE, DELETE)
    async run(sql, params = []) {
        return new Promise((resolve, reject) => {
            if (this.isPostgres) {
                // Convertir les ? en $1, $2, $3 pour PostgreSQL
                const convertedSQL = this.convertSQLParams(sql);
                this.pool.query(convertedSQL, params, (err, result) => {
                    if (err) reject(err);
                    else resolve({ 
                        lastID: result.insertId || null, 
                        changes: result.rowCount || 0 
                    });
                });
            } else {
                this.db.run(sql, params, function(err) {
                    if (err) reject(err);
                    else resolve({ lastID: this.lastID, changes: this.changes });
                });
            }
        });
    }

    // Méthode pour les transactions
    serialize(callback) {
        if (this.isPostgres) {
            // PostgreSQL gère les transactions différemment
            callback();
        } else {
            this.db.serialize(callback);
        }
    }

    // Convertir les paramètres ? en $1, $2, $3 pour PostgreSQL
    convertSQLParams(sql) {
        if (!this.isPostgres) return sql;
        
        let paramIndex = 1;
        return sql.replace(/\?/g, () => `$${paramIndex++}`);
    }

    // Adapter les requêtes SQL selon la base
    adaptSQL(sqliteSQL, postgresSQL) {
        return this.isPostgres ? postgresSQL : sqliteSQL;
    }
}

module.exports = DatabaseAdapter;