// Configuration de base de données adaptative (SQLite ou PostgreSQL)
const sqlite3 = require('sqlite3').verbose();

// Fonction pour créer les tables (compatible SQLite et PostgreSQL)
const createTables = (db, isPostgres = false) => {
    const userTableSQL = isPostgres ? `
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            nom VARCHAR(255) NOT NULL,
            prenom VARCHAR(255) NOT NULL,
            role VARCHAR(50) DEFAULT 'membre',
            licence_type VARCHAR(50) DEFAULT 'Loisir/Senior',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ` : `
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            nom TEXT NOT NULL,
            prenom TEXT NOT NULL,
            role TEXT DEFAULT 'membre',
            licence_type TEXT DEFAULT 'Loisir/Senior',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    const creneauxTableSQL = isPostgres ? `
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
    ` : `
        CREATE TABLE IF NOT EXISTS creneaux (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            jour_semaine INTEGER NOT NULL,
            heure_debut TEXT NOT NULL,
            heure_fin TEXT NOT NULL,
            capacite_max INTEGER NOT NULL,
            licences_autorisees TEXT DEFAULT 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles',
            actif BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    // Autres tables...
    const inscriptionsTableSQL = isPostgres ? `
        CREATE TABLE IF NOT EXISTS inscriptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            creneau_id INTEGER NOT NULL,
            statut VARCHAR(20) DEFAULT 'inscrit',
            position_attente INTEGER NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (creneau_id) REFERENCES creneaux (id),
            UNIQUE(user_id, creneau_id)
        )
    ` : `
        CREATE TABLE IF NOT EXISTS inscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            creneau_id INTEGER NOT NULL,
            statut TEXT DEFAULT 'inscrit',
            position_attente INTEGER NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (creneau_id) REFERENCES creneaux (id),
            UNIQUE(user_id, creneau_id)
        )
    `;

    const licenceLimitsTableSQL = isPostgres ? `
        CREATE TABLE IF NOT EXISTS licence_limits (
            id SERIAL PRIMARY KEY,
            licence_type VARCHAR(50) UNIQUE NOT NULL,
            max_seances_semaine INTEGER NOT NULL DEFAULT 3,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ` : `
        CREATE TABLE IF NOT EXISTS licence_limits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            licence_type TEXT UNIQUE NOT NULL,
            max_seances_semaine INTEGER NOT NULL DEFAULT 3,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `;

    return {
        users: userTableSQL,
        creneaux: creneauxTableSQL,
        inscriptions: inscriptionsTableSQL,
        licence_limits: licenceLimitsTableSQL
    };
};

module.exports = { createTables };