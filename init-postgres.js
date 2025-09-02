const { Pool } = require('pg');
const bcrypt = require('bcrypt');

async function initializePostgreSQL() {
    if (!process.env.DATABASE_URL) {
        console.log('❌ DATABASE_URL non définie, initialisation PostgreSQL ignorée');
        return;
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    try {
        console.log('🐘 Initialisation de PostgreSQL...');

        // Créer les tables
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password TEXT NOT NULL,
                nom VARCHAR(255) NOT NULL,
                prenom VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'membre',
                licence_type VARCHAR(100) DEFAULT 'Loisir/Senior',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS creneaux (
                id SERIAL PRIMARY KEY,
                nom VARCHAR(255) NOT NULL,
                jour_semaine INTEGER NOT NULL,
                heure_debut VARCHAR(10) NOT NULL,
                heure_fin VARCHAR(10) NOT NULL,
                capacite_max INTEGER NOT NULL,
                licences_autorisees TEXT DEFAULT 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles',
                actif BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS inscriptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                creneau_id INTEGER NOT NULL REFERENCES creneaux(id),
                statut VARCHAR(50) DEFAULT 'inscrit',
                position_attente INTEGER NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, creneau_id)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS licence_limits (
                id SERIAL PRIMARY KEY,
                licence_type VARCHAR(100) UNIQUE NOT NULL,
                max_seances_semaine INTEGER NOT NULL DEFAULT 3,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tables des méta-règles
        await pool.query(`
            CREATE TABLE IF NOT EXISTS meta_rules_config (
                id SERIAL PRIMARY KEY,
                enabled BOOLEAN DEFAULT FALSE,
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_by INTEGER REFERENCES users(id)
            )
        `);

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

        // Créer admin par défaut
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@triathlon.com';
        const adminPassword = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);
        
        await pool.query(`
            INSERT INTO users (email, password, nom, prenom, role) 
            VALUES ($1, $2, 'Admin', 'Système', 'admin')
            ON CONFLICT (email) DO NOTHING
        `, [adminEmail, adminPassword]);

        // Créer créneaux de test si aucun n'existe
        const { rows: existingCreneaux } = await pool.query('SELECT COUNT(*) as count FROM creneaux');
        if (existingCreneaux[0].count == 0) {
            console.log('Création des créneaux de test...');
            const creneauxTest = [
                ['Natation Débutants', 1, '18:00', '19:00', 8, 'Loisir/Senior'],
                ['Natation Confirmés', 1, '19:00', '20:00', 6, 'Compétition,Loisir/Senior'],
                ['École de Natation', 3, '12:00', '13:00', 10, 'Poussins/Pupilles,Benjamins/Junior'],
                ['Entraînement Compétition', 5, '18:30', '19:30', 12, 'Compétition'],
                ['Natation Libre', 6, '10:00', '11:00', 15, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles']
            ];
            
            for (const [nom, jour, debut, fin, capacite, licences] of creneauxTest) {
                await pool.query(`
                    INSERT INTO creneaux (nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees) 
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [nom, jour, debut, fin, capacite, licences]);
            }
        }

        // Créer limites par défaut si aucune n'existe
        const { rows: existingLimits } = await pool.query('SELECT COUNT(*) as count FROM licence_limits');
        if (existingLimits[0].count == 0) {
            const limitesParDefaut = [
                ['Compétition', 6],
                ['Loisir/Senior', 3],
                ['Benjamins/Junior', 4],
                ['Poussins/Pupilles', 2]
            ];

            for (const [licenceType, maxSeances] of limitesParDefaut) {
                await pool.query(`
                    INSERT INTO licence_limits (licence_type, max_seances_semaine) 
                    VALUES ($1, $2)
                    ON CONFLICT (licence_type) DO NOTHING
                `, [licenceType, maxSeances]);
            }
        }

        // Initialiser la configuration des méta-règles si elle n'existe pas
        const { rows: existingMetaConfig } = await pool.query('SELECT COUNT(*) as count FROM meta_rules_config');
        if (existingMetaConfig[0].count == 0) {
            await pool.query(`
                INSERT INTO meta_rules_config (enabled, description) 
                VALUES ($1, $2)
            `, [false, 'Configuration des méta-règles d\'inscription par licence']);
        }

        console.log('✅ PostgreSQL initialisé avec succès');
        await pool.end();
    } catch (error) {
        console.error('❌ Erreur initialisation PostgreSQL:', error);
        await pool.end();
        throw error;
    }
}

// Exécuter si appelé directement
if (require.main === module) {
    initializePostgreSQL()
        .then(() => {
            console.log('✅ Initialisation terminée');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Échec de l\'initialisation:', error);
            process.exit(1);
        });
}

module.exports = initializePostgreSQL;