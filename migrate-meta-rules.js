const { Pool } = require('pg');

async function migrateMetaRules() {
    if (!process.env.DATABASE_URL) {
        console.log('❌ DATABASE_URL non définie');
        return;
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    try {
        console.log('🔄 Migration des méta-règles...');

        // Créer la table de configuration des méta-règles
        await pool.query(`
            CREATE TABLE IF NOT EXISTS meta_rules_config (
                id SERIAL PRIMARY KEY,
                enabled BOOLEAN DEFAULT FALSE,
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_by INTEGER REFERENCES users(id)
            )
        `);
        console.log('✅ Table meta_rules_config créée');

        // Créer la table des méta-règles
        await pool.query(`
            CREATE TABLE IF NOT EXISTS meta_rules (
                id SERIAL PRIMARY KEY,
                licence_type VARCHAR(100) NOT NULL,
                jour_source INTEGER NOT NULL,
                jours_interdits TEXT NOT NULL,
                description TEXT,
                active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER REFERENCES users(id)
            )
        `);
        console.log('✅ Table meta_rules créée');

        // Initialiser la configuration par défaut
        const { rows: existingConfig } = await pool.query('SELECT COUNT(*) as count FROM meta_rules_config');
        if (existingConfig[0].count == 0) {
            await pool.query(`
                INSERT INTO meta_rules_config (enabled, description) 
                VALUES ($1, $2)
            `, [false, 'Configuration des méta-règles d\'inscription par licence']);
            console.log('✅ Configuration par défaut créée');
        } else {
            console.log('ℹ️ Configuration déjà existante');
        }

        console.log('🎉 Migration des méta-règles terminée avec succès !');
        await pool.end();
    } catch (error) {
        console.error('❌ Erreur migration méta-règles:', error);
        await pool.end();
        throw error;
    }
}

// Exécuter si appelé directement
if (require.main === module) {
    migrateMetaRules()
        .then(() => {
            console.log('✅ Migration terminée');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Échec de la migration:', error);
            process.exit(1);
        });
}

module.exports = migrateMetaRules;