// Script de migration vers PostgreSQL
const DatabaseAdapter = require('./database');

async function migrateDatabase() {
    const db = new DatabaseAdapter();
    
    try {
        console.log('🔄 Début de la migration...');
        
        // Créer les tables
        await createTables(db);
        
        // Initialiser les données par défaut
        await initializeDefaultData(db);
        
        console.log('✅ Migration terminée avec succès !');
    } catch (error) {
        console.error('❌ Erreur lors de la migration:', error);
    }
}

async function createTables(db) {
    // Table users
    const createUsersSQL = db.adaptSQL(
        // SQLite
        `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            nom TEXT NOT NULL,
            prenom TEXT NOT NULL,
            role TEXT DEFAULT 'membre',
            licence_type TEXT DEFAULT 'Loisir/Senior',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        // PostgreSQL
        `CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            nom VARCHAR(255) NOT NULL,
            prenom VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'membre',
            licence_type VARCHAR(50) DEFAULT 'Loisir/Senior',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    );
    await db.run(createUsersSQL);
    console.log('✅ Table users créée');

    // Table creneaux
    const createCreneauxSQL = db.adaptSQL(
        // SQLite
        `CREATE TABLE IF NOT EXISTS creneaux (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            jour_semaine INTEGER NOT NULL,
            heure_debut TEXT NOT NULL,
            heure_fin TEXT NOT NULL,
            capacite_max INTEGER NOT NULL,
            licences_autorisees TEXT DEFAULT 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles',
            actif BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        // PostgreSQL
        `CREATE TABLE IF NOT EXISTS creneaux (
            id SERIAL PRIMARY KEY,
            nom VARCHAR(255) NOT NULL,
            jour_semaine INTEGER NOT NULL,
            heure_debut VARCHAR(10) NOT NULL,
            heure_fin VARCHAR(10) NOT NULL,
            capacite_max INTEGER NOT NULL,
            licences_autorisees TEXT DEFAULT 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles',
            actif BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    );
    await db.run(createCreneauxSQL);
    console.log('✅ Table creneaux créée');

    // Table inscriptions
    const createInscriptionsSQL = db.adaptSQL(
        // SQLite
        `CREATE TABLE IF NOT EXISTS inscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            creneau_id INTEGER NOT NULL,
            statut TEXT DEFAULT 'inscrit',
            position_attente INTEGER NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (creneau_id) REFERENCES creneaux (id),
            UNIQUE(user_id, creneau_id)
        )`,
        // PostgreSQL
        `CREATE TABLE IF NOT EXISTS inscriptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            creneau_id INTEGER NOT NULL,
            statut VARCHAR(20) DEFAULT 'inscrit',
            position_attente INTEGER NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (creneau_id) REFERENCES creneaux (id),
            UNIQUE(user_id, creneau_id)
        )`
    );
    await db.run(createInscriptionsSQL);
    console.log('✅ Table inscriptions créée');

    // Table licence_limits
    const createLimitsSQL = db.adaptSQL(
        // SQLite
        `CREATE TABLE IF NOT EXISTS licence_limits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            licence_type TEXT UNIQUE NOT NULL,
            max_seances_semaine INTEGER NOT NULL DEFAULT 3,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        // PostgreSQL
        `CREATE TABLE IF NOT EXISTS licence_limits (
            id SERIAL PRIMARY KEY,
            licence_type VARCHAR(50) UNIQUE NOT NULL,
            max_seances_semaine INTEGER NOT NULL DEFAULT 3,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    );
    await db.run(createLimitsSQL);
    console.log('✅ Table licence_limits créée');
}

async function initializeDefaultData(db) {
    const bcrypt = require('bcrypt');
    
    // Créer admin par défaut
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@triathlon.com';
    const adminPassword = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);
    
    try {
        await db.run(`INSERT INTO users (email, password, nom, prenom, role) VALUES (?, ?, ?, ?, ?)`,
            [adminEmail, adminPassword, 'Admin', 'Système', 'admin']);
        console.log('✅ Admin créé');
    } catch (err) {
        if (err.message.includes('UNIQUE') || err.message.includes('duplicate')) {
            console.log('ℹ️ Admin existe déjà');
        } else {
            throw err;
        }
    }

    // Créer utilisateur de test (seulement en développement)
    if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
        try {
            const userPassword = bcrypt.hashSync('test123', 10);
            await db.run(`INSERT INTO users (email, password, nom, prenom, licence_type) VALUES (?, ?, ?, ?, ?)`,
                ['test@triathlon.com', userPassword, 'Dupont', 'Jean', 'Loisir/Senior']);
            console.log('✅ Utilisateur test créé');
        } catch (err) {
            if (err.message.includes('UNIQUE') || err.message.includes('duplicate')) {
                console.log('ℹ️ Utilisateur test existe déjà');
            } else {
                throw err;
            }
        }
    }

    // Créer créneaux de test
    const creneauxTest = [
        ['Natation Débutants', 1, '18:00', '19:00', 8, 'Loisir/Senior'],
        ['Natation Confirmés', 1, '19:00', '20:00', 6, 'Compétition,Loisir/Senior'],
        ['École de Natation', 3, '12:00', '13:00', 10, 'Poussins/Pupilles,Benjamins/Junior'],
        ['Entraînement Compétition', 5, '18:30', '19:30', 12, 'Compétition'],
        ['Natation Libre', 6, '10:00', '11:00', 15, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles']
    ];

    const existingCreneaux = await db.query('SELECT COUNT(*) as count FROM creneaux');
    const count = existingCreneaux[0].count || existingCreneaux[0]['COUNT(*)'];
    
    if (count == 0) {
        for (const [nom, jour, debut, fin, capacite, licences] of creneauxTest) {
            await db.run(`INSERT INTO creneaux (nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees) 
                         VALUES (?, ?, ?, ?, ?, ?)`, [nom, jour, debut, fin, capacite, licences]);
        }
        console.log('✅ Créneaux de test créés');
    } else {
        console.log('ℹ️ Créneaux existent déjà');
    }

    // Créer limites par défaut
    const limitesParDefaut = [
        ['Compétition', 6],
        ['Loisir/Senior', 3],
        ['Benjamins/Junior', 4],
        ['Poussins/Pupilles', 2]
    ];

    const existingLimits = await db.query('SELECT COUNT(*) as count FROM licence_limits');
    const limitCount = existingLimits[0].count || existingLimits[0]['COUNT(*)'];
    
    if (limitCount == 0) {
        for (const [licenceType, maxSeances] of limitesParDefaut) {
            await db.run(`INSERT INTO licence_limits (licence_type, max_seances_semaine) VALUES (?, ?)`,
                [licenceType, maxSeances]);
        }
        console.log('✅ Limites de séances créées');
    } else {
        console.log('ℹ️ Limites existent déjà');
    }
}

module.exports = { migrateDatabase };

// Exécuter si appelé directement
if (require.main === module) {
    migrateDatabase();
}