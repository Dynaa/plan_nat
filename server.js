require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const DatabaseAdapter = require('./database');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const { verifierLimitesSeances, verifierRegleBloc } = require('./services/businessRules');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Healthcheck pour Railway
app.get('/health', (req, res) => res.status(200).send('OK'));

// Configuration de session adaptée à l'environnement
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'triathlon-natation-secret-key-dev',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Désactivé pour Railway (HTTPS mais proxy)
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 heures
        sameSite: 'lax' // Plus permissif que 'strict'
    }
};

// Configuration spéciale pour Railway
if (process.env.NODE_ENV === 'production') {
    console.log('🔧 Configuration session pour Railway (production)');
    // Railway utilise un proxy, donc secure: false même en HTTPS
    sessionConfig.cookie.secure = false;
    sessionConfig.cookie.sameSite = 'lax';
    console.log('⚠️ Utilisation de MemoryStore en production (OK pour petite app)');
}

app.use(session(sessionConfig));

// Configuration email
const emailConfig = {
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_PORT === '465', // true pour 465, false pour 587
    auth: {
        user: process.env.SMTP_USER || 'ethereal.user@ethereal.email',
        pass: process.env.SMTP_PASS || 'ethereal.pass'
    },
    // Options supplémentaires pour OVH
    tls: {
        rejectUnauthorized: false
    },
    connectionTimeout: 10000, // 10 secondes
    greetingTimeout: 5000,
    socketTimeout: 10000
};

// Créer le transporteur email
let transporter;
const initEmailTransporter = async () => {
    console.log('📧 Début initEmailTransporter...');
    console.log('📧 Variables SMTP:', {
        host: !!process.env.SMTP_HOST,
        user: !!process.env.SMTP_USER,
        pass: !!process.env.SMTP_PASS,
        nodeEnv: process.env.NODE_ENV
    });

    try {
        // En production, utiliser Ethereal si aucun service email configuré
        if (process.env.NODE_ENV === 'production' && !process.env.RESEND_API_KEY && !process.env.SENDGRID_API_KEY && (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS)) {
            console.log('📧 Mode production : utilisation d\'Ethereal Email pour les tests');
            // Ne pas retourner, continuer avec Ethereal
        }

        if (!process.env.SMTP_HOST) {
            console.log('📧 Pas de SMTP_HOST défini, création compte Ethereal...');
            const testAccount = await nodemailer.createTestAccount();
            emailConfig.auth.user = testAccount.user;
            emailConfig.auth.pass = testAccount.pass;
            console.log('=== Configuration Email de Test ===');
            console.log('User:', testAccount.user);
            console.log('Pass:', testAccount.pass);
            console.log('Prévisualisez les emails sur: https://ethereal.email');
            console.log('===================================');
        } else {
            console.log('📧 SMTP_HOST défini:', process.env.SMTP_HOST);
        }

        transporter = nodemailer.createTransport(emailConfig);
        await transporter.verify();
        console.log('✅ Serveur email configuré avec succès');
        console.log('📧 Configuration email active:', {
            host: emailConfig.host,
            port: emailConfig.port,
            user: emailConfig.auth.user,
            secure: emailConfig.secure,
            tls: emailConfig.tls
        });

        // Diagnostic spécial pour OVH
        if (emailConfig.host.includes('ovh')) {
            console.log('🔍 Diagnostic OVH:');
            console.log('- Serveur SMTP:', emailConfig.host);
            console.log('- Port:', emailConfig.port, emailConfig.secure ? '(SSL)' : '(TLS)');
            console.log('- Utilisateur:', emailConfig.auth.user);
            console.log('- Mot de passe défini:', !!emailConfig.auth.pass);
        }
    } catch (error) {
        console.error('❌ Erreur configuration email:', error.message);
        console.log('📧 Les notifications email seront désactivées');
        transporter = null;
    }
};

// Initialiser le transporteur email
console.log('🔄 Démarrage initialisation email...');
initEmailTransporter().catch(err => {
    console.error('❌ Erreur critique initialisation email:', err);
});

// Debug des variables d'environnement (seulement en production pour diagnostiquer)
if (process.env.NODE_ENV === 'production') {
    console.log('🔍 Variables d\'environnement Railway:');
    console.log('- NODE_ENV:', process.env.NODE_ENV);
    console.log('- PORT:', process.env.PORT);
    console.log('- DATABASE_URL présente:', !!process.env.DATABASE_URL);
    console.log('- RAILWAY_ENVIRONMENT:', process.env.RAILWAY_ENVIRONMENT);

    // Afficher le début de DATABASE_URL sans exposer les credentials
    if (process.env.DATABASE_URL) {
        const dbUrl = process.env.DATABASE_URL;
        console.log('- DATABASE_URL commence par:', dbUrl.substring(0, 15) + '...');
    }
}

// Fonction d'initialisation unifiée de la base de données
async function initializeDatabase() {
    try {
        console.log('🔧 Début initialisation de la base de données...');
        console.log('🔧 Type de base:', db.isPostgres ? 'PostgreSQL' : 'SQLite');

        // Table des utilisateurs
        const usersSQL = db.adaptSQL(
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
                licence_type VARCHAR(100) DEFAULT 'Loisir/Senior',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        );
        console.log('🔧 Création table users...');
        await db.run(usersSQL);
        console.log('✅ Table users créée');

        // Table des créneaux
        const creneauxSQL = db.adaptSQL(
            // SQLite
            `CREATE TABLE IF NOT EXISTS creneaux (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nom TEXT NOT NULL,
                jour_semaine INTEGER NOT NULL,
                heure_debut TEXT NOT NULL,
                heure_fin TEXT NOT NULL,
                nombre_lignes INTEGER NOT NULL DEFAULT 2,
                personnes_par_ligne INTEGER NOT NULL DEFAULT 6,
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
                nombre_lignes INTEGER NOT NULL DEFAULT 2,
                personnes_par_ligne INTEGER NOT NULL DEFAULT 6,
                licences_autorisees TEXT DEFAULT 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles',
                actif BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        );
        console.log('🔧 Création table creneaux...');
        await db.run(creneauxSQL);
        console.log('✅ Table creneaux créée');

        // Table des inscriptions
        const inscriptionsSQL = db.adaptSQL(
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
                statut VARCHAR(50) DEFAULT 'inscrit',
                position_attente INTEGER NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (creneau_id) REFERENCES creneaux (id),
                UNIQUE(user_id, creneau_id)
            )`
        );
        console.log('🔧 Création table inscriptions...');
        await db.run(inscriptionsSQL);
        console.log('✅ Table inscriptions créée');

        // Table des limites de séances
        const limitsSQL = db.adaptSQL(
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
                licence_type VARCHAR(100) UNIQUE NOT NULL,
                max_seances_semaine INTEGER NOT NULL DEFAULT 3,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        );
        console.log('🔧 Création table licence_limits...');
        await db.run(limitsSQL);
        console.log('✅ Table licence_limits créée');

        // Table des blocs hebdomadaires
        const blocsSQL = db.adaptSQL(
            // SQLite
            `CREATE TABLE IF NOT EXISTS blocs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nom TEXT NOT NULL,
                description TEXT,
                ordre INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            // PostgreSQL
            `CREATE TABLE IF NOT EXISTS blocs (
                id SERIAL PRIMARY KEY,
                nom VARCHAR(255) NOT NULL,
                description TEXT,
                ordre INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        );
        console.log('🔧 Création table blocs...');
        await db.run(blocsSQL);
        console.log('✅ Table blocs créée');

        // Table de liaison blocs ↔ créneaux
        const blocCreneauxSQL = db.adaptSQL(
            // SQLite
            `CREATE TABLE IF NOT EXISTS bloc_creneaux (
                bloc_id INTEGER NOT NULL,
                creneau_id INTEGER NOT NULL,
                PRIMARY KEY (bloc_id, creneau_id),
                FOREIGN KEY (bloc_id) REFERENCES blocs(id) ON DELETE CASCADE,
                FOREIGN KEY (creneau_id) REFERENCES creneaux(id) ON DELETE CASCADE
            )`,
            // PostgreSQL
            `CREATE TABLE IF NOT EXISTS bloc_creneaux (
                bloc_id INTEGER NOT NULL,
                creneau_id INTEGER NOT NULL,
                PRIMARY KEY (bloc_id, creneau_id),
                FOREIGN KEY (bloc_id) REFERENCES blocs(id) ON DELETE CASCADE,
                FOREIGN KEY (creneau_id) REFERENCES creneaux(id) ON DELETE CASCADE
            )`
        );
        console.log('🔧 Création table bloc_creneaux...');
        await db.run(blocCreneauxSQL);
        console.log('✅ Table bloc_creneaux créée');

        // Table des tokens d'inscription pour la liste d'attente
        const waitlistTokensSQL = db.adaptSQL(
            // SQLite
            `CREATE TABLE IF NOT EXISTS waitlist_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT UNIQUE NOT NULL,
                user_id INTEGER NOT NULL,
                creneau_id INTEGER NOT NULL,
                expires_at DATETIME NOT NULL,
                used BOOLEAN DEFAULT FALSE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (creneau_id) REFERENCES creneaux(id)
            )`,
            // PostgreSQL
            `CREATE TABLE IF NOT EXISTS waitlist_tokens (
                id SERIAL PRIMARY KEY,
                token VARCHAR(255) UNIQUE NOT NULL,
                user_id INTEGER NOT NULL,
                creneau_id INTEGER NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                used BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (creneau_id) REFERENCES creneaux(id)
            )`
        );
        console.log('🔧 Création table waitlist_tokens...');
        await db.run(waitlistTokensSQL);
        console.log('✅ Table waitlist_tokens créée');

        // Table de configuration des méta-règles
        const metaRulesConfigSQL = db.adaptSQL(
            // SQLite
            `CREATE TABLE IF NOT EXISTS meta_rules_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                enabled BOOLEAN DEFAULT 0,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            // PostgreSQL
            `CREATE TABLE IF NOT EXISTS meta_rules_config (
                id SERIAL PRIMARY KEY,
                enabled BOOLEAN DEFAULT false,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        );
        console.log('🔧 Création table meta_rules_config...');
        await db.run(metaRulesConfigSQL);
        console.log('✅ Table meta_rules_config créée');

        // Table des méta-règles
        const metaRulesSQL = db.adaptSQL(
            // SQLite
            `CREATE TABLE IF NOT EXISTS meta_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                licence_type TEXT NOT NULL,
                jour_source INTEGER NOT NULL,
                jours_interdits TEXT NOT NULL,
                description TEXT,
                active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            // PostgreSQL
            `CREATE TABLE IF NOT EXISTS meta_rules (
                id SERIAL PRIMARY KEY,
                licence_type VARCHAR(100) NOT NULL,
                jour_source INTEGER NOT NULL,
                jours_interdits TEXT NOT NULL,
                description TEXT,
                active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        );
        console.log('🔧 Création table meta_rules...');
        await db.run(metaRulesSQL);
        console.log('✅ Table meta_rules créée');

        // Créer admin par défaut
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@triathlon.com';
        const adminPassword = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);

        const insertAdminSQL = db.adaptSQL(
            `INSERT OR IGNORE INTO users (email, password, nom, prenom, role) VALUES (?, ?, 'Admin', 'Système', 'admin')`,
            `INSERT INTO users (email, password, nom, prenom, role) VALUES (?, ?, 'Admin', 'Système', 'admin') ON CONFLICT (email) DO NOTHING`
        );
        await db.run(insertAdminSQL, [adminEmail, adminPassword]);

        // Créer utilisateur de test (seulement en développement)
        if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
            const userPassword = bcrypt.hashSync('test123', 10);
            const insertUserSQL = db.adaptSQL(
                `INSERT OR IGNORE INTO users (email, password, nom, prenom, licence_type) VALUES (?, ?, 'Dupont', 'Jean', 'Loisir/Senior')`,
                `INSERT INTO users (email, password, nom, prenom, licence_type) VALUES (?, ?, 'Dupont', 'Jean', 'Loisir/Senior') ON CONFLICT (email) DO NOTHING`
            );
            await db.run(insertUserSQL, ['test@triathlon.com', userPassword]);
        }

        // Créer créneaux de test
        const creneauxCount = await db.get(`SELECT COUNT(*) as count FROM creneaux`);
        if (!creneauxCount || creneauxCount.count === 0) {
            console.log('Création des créneaux de test...');
            // Créneaux de référence (Lundi=1, Mardi=2, Mercredi=3, Jeudi=4, Vendredi=5, Samedi=6)
            const creneauxTest = [
                // Bloc début de semaine
                ['Lundi Matin 7h-8h', 1, '07:00', '08:00', 2, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles'],
                ['Lundi 11h15-12h30', 1, '11:15', '12:30', 2, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles'],
                ['Lundi 12h30-13h30', 1, '12:30', '13:30', 2, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles'],
                ['Mardi Matin 7h-8h30', 2, '07:00', '08:30', 2, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles'],
                // Bloc milieu de semaine
                ['Mercredi Matin 7h-8h', 3, '07:00', '08:00', 1, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles'],
                ['Jeudi Matin 7h-8h', 4, '07:00', '08:00', 1, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles'],
                ['Jeudi Soir 20h30-21h30', 4, '20:30', '21:30', 3, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles'],
                ['Vendredi Midi 12h-13h30', 5, '12:00', '13:30', 2, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles'],
                // Bloc fin de semaine
                ['Samedi Matin 8h-9h', 6, '08:00', '09:00', 4, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles'],
            ];

            for (const [nom, jour, debut, fin, lignes, personnes, licences] of creneauxTest) {
                await db.run(`INSERT INTO creneaux (nom, jour_semaine, heure_debut, heure_fin, nombre_lignes, personnes_par_ligne, licences_autorisees) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [nom, jour, debut, fin, lignes, personnes, licences]);
            }
        }

        // Créer limites par défaut
        const limitsCount = await db.get(`SELECT COUNT(*) as count FROM licence_limits`);
        if (!limitsCount || limitsCount.count === 0) {
            const limitesParDefaut = [
                ['Compétition', 6],
                ['Loisir/Senior', 3],
                ['Benjamins/Junior', 4],
                ['Poussins/Pupilles', 2]
            ];

            for (const [licenceType, maxSeances] of limitesParDefaut) {
                await db.run(`INSERT INTO licence_limits (licence_type, max_seances_semaine) VALUES (?, ?)`,
                    [licenceType, maxSeances]);
            }
        }

        // Créer configuration méta-règles par défaut
        const metaConfigCount = await db.get(`SELECT COUNT(*) as count FROM meta_rules_config`);
        if (!metaConfigCount || metaConfigCount.count === 0) {
            await db.run(`INSERT INTO meta_rules_config (enabled, description) VALUES (?, ?)`,
                [false, 'Configuration des méta-règles d\'inscription']);
        }

        // Créer les 3 blocs hebdomadaires de référence
        const blocsCount = await db.get(`SELECT COUNT(*) as count FROM blocs`);
        if (!blocsCount || blocsCount.count === 0) {
            console.log('Création des blocs de référence...');
            await db.run(`INSERT INTO blocs (nom, description, ordre) VALUES (?, ?, ?)`,
                ['Début de semaine', 'Lundi et Mardi', 1]);
            await db.run(`INSERT INTO blocs (nom, description, ordre) VALUES (?, ?, ?)`,
                ['Milieu de semaine', 'Mercredi, Jeudi et Vendredi', 2]);
            await db.run(`INSERT INTO blocs (nom, description, ordre) VALUES (?, ?, ?)`,
                ['Fin de semaine', 'Samedi', 3]);

            // Si les créneaux ont été créés (count > 0 avant l'insert), les associer aux blocs
            const creneauxActuels = await db.query(`SELECT id, nom FROM creneaux ORDER BY id`);
            if (creneauxActuels && creneauxActuels.length >= 9) {
                const blocDebut = await db.get(`SELECT id FROM blocs WHERE ordre = 1`);
                const blocMilieu = await db.get(`SELECT id FROM blocs WHERE ordre = 2`);
                const blocFin = await db.get(`SELECT id FROM blocs WHERE ordre = 3`);

                if (blocDebut && blocMilieu && blocFin) {
                    const blocDebutId = blocDebut.id;
                    const blocMilieuId = blocMilieu.id;
                    const blocFinId = blocFin.id;

                    // Début de semaine : créneaux 1-4
                    for (const c of creneauxActuels.slice(0, 4)) {
                        await db.run(`INSERT INTO bloc_creneaux (bloc_id, creneau_id) VALUES (?, ?)`, [blocDebutId, c.id]);
                    }
                    // Milieu de semaine : créneaux 5-8
                    for (const c of creneauxActuels.slice(4, 8)) {
                        await db.run(`INSERT INTO bloc_creneaux (bloc_id, creneau_id) VALUES (?, ?)`, [blocMilieuId, c.id]);
                    }
                    // Fin de semaine : créneau 9
                    for (const c of creneauxActuels.slice(8, 9)) {
                        await db.run(`INSERT INTO bloc_creneaux (bloc_id, creneau_id) VALUES (?, ?)`, [blocFinId, c.id]);
                    }
                    console.log('✅ Blocs et associations créés');
                }
            }
        }

        console.log('✅ Base de données initialisée avec succès');
    } catch (err) {
        console.error('❌ Erreur initialisation base de données:', err);
        throw err;
    }
}

// Initialisation de la base de données (SQLite ou PostgreSQL)
const db = new DatabaseAdapter();

// Initialisation de la base de données
console.log('🔄 Initialisation de la base de données...');
console.log('🔍 DATABASE_URL présente:', !!process.env.DATABASE_URL);
console.log('🔍 Type détecté:', db.isPostgres ? 'PostgreSQL' : 'SQLite');

// Initialisation unifiée pour PostgreSQL et SQLite
initializeDatabase().then(() => {
    console.log(`✅ Base de données ${db.isPostgres ? 'PostgreSQL' : 'SQLite'} initialisée avec succès`);
}).catch(err => {
    console.error('❌ ERREUR CRITIQUE initialisation base de données:', err);
    console.error('❌ Stack trace:', err.stack);
});

// Fonction pour générer un token sécurisé
const crypto = require('crypto');
const generateWaitlistToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

// Fonction pour créer un token d'inscription et envoyer l'email
const notifyWaitlistUser = async (userId, creneauId) => {
    try {
        // Récupérer les infos utilisateur et créneau
        const userInfo = await db.get(`SELECT email, nom, prenom FROM users WHERE id = ?`, [userId]);
        const creneauInfo = await db.get(`SELECT nom, jour_semaine, heure_debut, heure_fin FROM creneaux WHERE id = ?`, [creneauId]);

        if (!userInfo || !creneauInfo) {
            console.error('❌ Utilisateur ou créneau introuvable pour notification');
            return false;
        }

        // Générer un token unique
        const token = generateWaitlistToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24); // Expire dans 24h

        // Sauvegarder le token
        await db.run(`INSERT INTO waitlist_tokens (token, user_id, creneau_id, expires_at) VALUES (?, ?, ?, ?)`,
            [token, userId, creneauId, expiresAt.toISOString()]);

        // Créer le lien d'inscription
        const baseUrl = process.env.BASE_URL || process.env.RAILWAY_STATIC_URL || 'http://localhost:3000';
        const inscriptionLink = `${baseUrl}/inscription-attente?token=${token}`;

        // Jours de la semaine
        const jours = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
        const jourNom = jours[creneauInfo.jour_semaine];

        // Template d'email
        const emailContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #2563eb;">🏊‍♀️ Une place s'est libérée !</h2>
                
                <p>Bonjour ${userInfo.prenom} ${userInfo.nom},</p>
                
                <p>Bonne nouvelle ! Une place s'est libérée pour le créneau :</p>
                
                <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <p style="margin: 0; color: #92400e; font-weight: bold;">
                        ⚡ Attention : Cet email a été envoyé à toutes les personnes en liste d'attente. 
                        Le premier qui confirme son inscription obtiendra la place !
                    </p>
                </div>
                
                <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <p style="margin: 0; color: #92400e; font-weight: bold;">
                        ⚡ Premier arrivé, premier servi !
                    </p>
                    <p style="margin: 5px 0 0 0; color: #92400e; font-size: 14px;">
                        Cet email a été envoyé à toutes les personnes en liste d'attente. Le premier qui confirme son inscription obtiendra la place.
                    </p>
                </div>
                
                <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin: 0; color: #1f2937;">${creneauInfo.nom}</h3>
                    <p style="margin: 10px 0 0 0; color: #6b7280;">
                        📅 ${jourNom}<br>
                        🕐 ${creneauInfo.heure_debut} - ${creneauInfo.heure_fin}
                    </p>
                </div>
                
                <p>Vous avez <strong>24 heures</strong> pour confirmer votre inscription en cliquant sur le lien ci-dessous :</p>
                
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${inscriptionLink}" 
                       style="background: #2563eb; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                        ✅ Confirmer mon inscription
                    </a>
                </div>
                
                <p style="color: #6b7280; font-size: 14px;">
                    ⚠️ Ce lien expire le ${expiresAt.toLocaleDateString('fr-FR')} à ${expiresAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </p>
                
                <p style="color: #6b7280; font-size: 14px;">
                    Si vous ne souhaitez plus vous inscrire à ce créneau, ignorez simplement cet email.
                </p>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                    Club de Triathlon - Gestion des créneaux de natation
                </p>
            </div>
        `;

        // Envoyer l'email
        const emailSent = await sendEmail(
            userInfo.email,
            `🏊‍♀️ Place disponible - ${creneauInfo.nom}`,
            emailContent
        );

        if (emailSent) {
            console.log(`✅ Email de notification envoyé à ${userInfo.email} pour le créneau ${creneauInfo.nom}`);
            return true;
        } else {
            console.error(`❌ Échec envoi email à ${userInfo.email}`);
            return false;
        }

    } catch (err) {
        console.error('❌ Erreur notification liste d\'attente:', err);
        return false;
    }
};

// Fonctions d'envoi d'email (Resend + SendGrid + SMTP)
const sendEmail = async (to, subject, htmlContent) => {
    // Priorité 1 : Resend si configuré (gratuit 3000 emails/mois)
    if (process.env.RESEND_API_KEY) {
        try {
            const resend = new Resend(process.env.RESEND_API_KEY);

            console.log('📧 Envoi via Resend:', { to, subject });
            const result = await resend.emails.send({
                from: process.env.SMTP_USER || 'noreply@resend.dev',
                to: to,
                subject: subject,
                html: htmlContent,
            });

            console.log('✅ Email envoyé via Resend:', { id: result.data?.id, to, subject });
            return true;
        } catch (error) {
            console.error('❌ Erreur Resend:', error.message);
            // Fallback vers SendGrid si Resend échoue
        }
    }

    // Priorité 2 : SMTP si transporteur configuré
    if (!transporter) {
        console.log('📧 Email non envoyé (aucun transporteur configuré):', subject);
        return false;
    }

    try {
        console.log('📧 Tentative d\'envoi email via SMTP:', { to, subject, from: process.env.SMTP_USER });

        const info = await transporter.sendMail({
            from: `"Club Triathlon 🏊‍♂️" <${process.env.SMTP_USER || 'noreply@triathlon.com'}>`,
            to: to,
            subject: subject,
            html: htmlContent
        });

        console.log('✅ Email envoyé via SMTP:', { messageId: info.messageId, to, subject });
        return true;
    } catch (error) {
        console.error('❌ Erreur SMTP:', {
            error: error.message,
            code: error.code,
            to: to,
            subject: subject
        });
        return false;
    }
};

// Middleware d'authentification
const requireAuth = (req, res, next) => {
    console.log('🔐 Vérification auth - Session:', {
        userId: req.session.userId,
        userRole: req.session.userRole,
        sessionID: req.sessionID
    });

    if (!req.session.userId) {
        console.log('❌ Authentification échouée - Pas de userId dans la session');
        return res.status(401).json({ error: 'Non authentifié' });
    }

    console.log('✅ Authentification réussie pour userId:', req.session.userId);
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.userId || req.session.userRole !== 'admin') {
        return res.status(403).json({ error: 'Accès administrateur requis' });
    }
    next();
};

// Routes d'authentification
app.post('/api/register', async (req, res) => {
    const { email, password, nom, prenom, licence_type } = req.body;

    if (!email || !password || !nom || !prenom || !licence_type) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    const licencesValides = ['Compétition', 'Loisir/Senior', 'Benjamins/Junior', 'Poussins/Pupilles'];
    if (!licencesValides.includes(licence_type)) {
        return res.status(400).json({ error: 'Type de licence invalide' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    try {
        const sql = db.isPostgres ?
            `INSERT INTO users (email, password, nom, prenom, licence_type) VALUES ($1, $2, $3, $4, $5) RETURNING id` :
            `INSERT INTO users (email, password, nom, prenom, licence_type) VALUES (?, ?, ?, ?, ?)`;

        const result = await db.run(sql, [email, hashedPassword, nom, prenom, licence_type]);

        res.json({
            message: 'Compte créé avec succès',
            userId: result.lastID || result.id
        });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed') || err.message.includes('duplicate key')) {
            return res.status(400).json({ error: 'Email déjà utilisé' });
        }
        console.error('Erreur création compte:', err);
        return res.status(500).json({ error: 'Erreur lors de la création du compte' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    console.log('Tentative de connexion pour:', email);

    if (!email || !password) {
        return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    try {
        // Utiliser la syntaxe PostgreSQL avec $1 au lieu de ?
        const sql = db.isPostgres ?
            `SELECT * FROM users WHERE email = $1` :
            `SELECT * FROM users WHERE email = ?`;

        const user = await db.get(sql, [email]);

        if (!user) {
            console.log('Utilisateur non trouvé:', email);
            return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        }

        console.log('Utilisateur trouvé:', user.email, 'Role:', user.role);

        if (bcrypt.compareSync(password, user.password)) {
            req.session.userId = user.id;
            req.session.userRole = user.role;
            req.session.userName = `${user.prenom} ${user.nom}`;

            console.log('Connexion réussie pour:', user.email);

            res.json({
                message: 'Connexion réussie',
                user: { id: user.id, nom: user.nom, prenom: user.prenom, role: user.role, licence_type: user.licence_type }
            });
        } else {
            console.log('Mot de passe incorrect pour:', email);
            res.status(401).json({ error: 'Email ou mot de passe incorrect' });
        }
    } catch (err) {
        console.error('Erreur base de données:', err);
        return res.status(500).json({ error: 'Erreur de base de données' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Déconnexion réussie' });
});

app.get('/api/auth-status', async (req, res) => {
    if (req.session.userId) {
        try {
            const sql = db.isPostgres ?
                `SELECT id, nom, prenom, role, licence_type FROM users WHERE id = $1` :
                `SELECT id, nom, prenom, role, licence_type FROM users WHERE id = ?`;

            const user = await db.get(sql, [req.session.userId]);

            if (!user) {
                return res.status(401).json({ authenticated: false });
            }

            res.json({
                authenticated: true,
                user: { id: user.id, nom: user.nom, prenom: user.prenom, role: user.role, licence_type: user.licence_type }
            });
        } catch (err) {
            console.error('Erreur auth-status:', err);
            return res.status(401).json({ authenticated: false });
        }
    } else {
        res.json({ authenticated: false });
    }
});

// Routes des créneaux
app.get('/api/creneaux', async (req, res) => {
    const userId = req.session ? req.session.userId : null;

    const query = db.isPostgres ? `
        SELECT c.*,
               (c.nombre_lignes * c.personnes_par_ligne) as capacite_max,
               COUNT(CASE WHEN i.statut = 'inscrit' THEN 1 END) as inscrits,
               COUNT(CASE WHEN i.statut = 'attente' THEN 1 END) as en_attente,
               b.id as bloc_id,
               b.nom as bloc_nom,
               CASE WHEN ub.user_id IS NOT NULL THEN ub.creneau_nom ELSE NULL END as inscrit_dans_bloc
        FROM creneaux c
        LEFT JOIN inscriptions i ON c.id = i.creneau_id
        LEFT JOIN bloc_creneaux bc ON c.id = bc.creneau_id
        LEFT JOIN blocs b ON bc.bloc_id = b.id
        LEFT JOIN (
            SELECT i2.user_id, bc2.bloc_id, c2.nom as creneau_nom
            FROM inscriptions i2
            JOIN creneaux c2 ON i2.creneau_id = c2.id
            JOIN bloc_creneaux bc2 ON c2.id = bc2.creneau_id
            WHERE i2.statut = 'inscrit' AND i2.user_id = $1::integer
        ) ub ON b.id = ub.bloc_id
        WHERE c.actif = true
        GROUP BY c.id, b.id, b.nom, ub.user_id, ub.creneau_nom
        ORDER BY c.jour_semaine, c.heure_debut
    ` : `
        SELECT c.*,
               (c.nombre_lignes * c.personnes_par_ligne) as capacite_max,
               COUNT(CASE WHEN i.statut = 'inscrit' THEN 1 END) as inscrits,
               COUNT(CASE WHEN i.statut = 'attente' THEN 1 END) as en_attente,
               b.id as bloc_id,
               b.nom as bloc_nom,
               ub.creneau_nom as inscrit_dans_bloc
        FROM creneaux c
        LEFT JOIN inscriptions i ON c.id = i.creneau_id
        LEFT JOIN bloc_creneaux bc ON c.id = bc.creneau_id
        LEFT JOIN blocs b ON bc.bloc_id = b.id
        LEFT JOIN (
            SELECT i2.user_id, bc2.bloc_id, c2.nom as creneau_nom
            FROM inscriptions i2
            JOIN creneaux c2 ON i2.creneau_id = c2.id
            JOIN bloc_creneaux bc2 ON c2.id = bc2.creneau_id
            WHERE i2.statut = 'inscrit' AND i2.user_id = ?
        ) ub ON b.id = ub.bloc_id
        WHERE c.actif = 1
        GROUP BY c.id, b.id, b.nom, ub.creneau_nom
        ORDER BY c.jour_semaine, c.heure_debut
    `;

    try {
        const rows = await db.query(query, [userId || null]);
        res.json(rows);
    } catch (err) {
        console.error('Erreur récupération créneaux:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des créneaux' });
    }
});


app.get('/api/creneaux/:creneauId', async (req, res) => {
    const creneauId = req.params.creneauId;

    try {
        const sql = db.isPostgres ?
            `SELECT * FROM creneaux WHERE id = $1` :
            `SELECT * FROM creneaux WHERE id = ?`;

        const creneau = await db.get(sql, [creneauId]);

        if (!creneau) {
            return res.status(404).json({ error: 'Créneau non trouvé' });
        }

        res.json(creneau);
    } catch (err) {
        console.error('Erreur récupération créneau:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération du créneau' });
    }
});

// Route pour récupérer la liste des inscrits à un créneau (PUBLIC)
app.get('/api/creneaux/:creneauId/inscrits', requireAuth, async (req, res) => {
    const creneauId = req.params.creneauId;

    const query = db.isPostgres ? `
        SELECT u.nom, u.prenom, i.statut, i.position_attente
        FROM inscriptions i
        JOIN users u ON i.user_id = u.id
        WHERE i.creneau_id = $1
        ORDER BY 
            CASE WHEN i.statut = 'inscrit' THEN 0 ELSE 1 END,
            i.position_attente ASC,
            i.created_at ASC
    ` : `
        SELECT u.nom, u.prenom, i.statut, i.position_attente
        FROM inscriptions i
        JOIN users u ON i.user_id = u.id
        WHERE i.creneau_id = ?
        ORDER BY 
            CASE WHEN i.statut = 'inscrit' THEN 0 ELSE 1 END,
            i.position_attente ASC,
            i.created_at ASC
    `;

    try {
        const rows = await db.query(query, [creneauId]);
        res.json(rows);
    } catch (err) {
        console.error('Erreur récupération inscrits publics:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des inscrits' });
    }
});

// Route pour les inscriptions de l'utilisateur
app.get('/api/mes-inscriptions', requireAuth, async (req, res) => {
    const userId = req.session.userId;

    const query = `
        SELECT i.*, c.nom, c.jour_semaine, c.heure_debut, c.heure_fin
        FROM inscriptions i
        JOIN creneaux c ON i.creneau_id = c.id
        WHERE i.user_id = ${db.isPostgres ? '$1' : '?'}
        ORDER BY c.jour_semaine, c.heure_debut
    `;

    console.log('Requête mes-inscriptions pour userId:', userId);

    try {
        const rows = await db.query(query, [userId]);
        console.log('Inscriptions trouvées:', rows.length);
        res.json(rows);
    } catch (err) {
        console.error('Erreur SQL mes-inscriptions:', err.message);
        return res.status(500).json({
            error: 'Erreur lors de la récupération des inscriptions'
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        database: 'SQLite'
    });
});

// Servir les fichiers statiques
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route pour servir la page d'inscription via token
app.get('/inscription-attente', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'inscription-attente.html'));
});

// Gestion des erreurs non capturées
process.on('uncaughtException', (error) => {
    console.error('❌ Erreur non capturée:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesse rejetée non gérée:', reason);
});

module.exports = app; // Mettre à disposition l'application pour les tests (Supertest)

if (require.main === module) {
    const server = app.listen(PORT, () => {
        console.log(`✅ Serveur démarré sur le port ${PORT}`);
        console.log(`🌍 Environnement: ${process.env.NODE_ENV || 'development'}`);

        if (process.env.NODE_ENV !== 'production') {
            console.log('=== Comptes de test ===');
            console.log('Admin: admin@triathlon.com / admin123');
            console.log('Utilisateur: test@triathlon.com / test123');
            console.log('=====================');
        } else {
            console.log('🔐 Mode production - Utilisez vos identifiants configurés');
        }
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${PORT} occupé, tentative sur le port ${PORT + 1}...`);
            server.listen(PORT + 1);
        } else {
            console.error('Erreur serveur:', err);
        }
    });
}

// ===== ENDPOINTS MÉTA-RÈGLES =====

// Récupérer la configuration des méta-règles
app.get('/api/admin/meta-rules-config', requireAdmin, async (req, res) => {
    try {
        const config = await db.get(`SELECT * FROM meta_rules_config ORDER BY id DESC LIMIT 1`);
        console.log('📋 Config méta-règles récupérée:', config);
        res.json(config || { enabled: false });
    } catch (err) {
        console.error('Erreur récupération config méta-règles:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Mettre à jour la configuration des méta-règles
app.put('/api/admin/meta-rules-config', requireAdmin, async (req, res) => {
    const { enabled, description } = req.body;
    const userId = req.session.userId;

    console.log('🔧 Mise à jour config méta-règles:', { enabled, description, userId });

    try {
        // Vérifier s'il y a déjà une config
        const existingConfig = await db.get(`SELECT * FROM meta_rules_config LIMIT 1`);

        if (existingConfig) {
            const updateSQL = db.adaptSQL(
                `UPDATE meta_rules_config SET enabled = ?, description = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?`,
                `UPDATE meta_rules_config SET enabled = ?, description = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ?`
            );
            await db.run(updateSQL, [enabled, description, userId]);
        } else {
            await db.run(`INSERT INTO meta_rules_config (enabled, description, updated_by) VALUES (?, ?, ?)`,
                [enabled, description, userId]);
        }

        console.log('✅ Config méta-règles mise à jour');
        res.json({ message: 'Configuration mise à jour' });
    } catch (err) {
        console.error('Erreur mise à jour config méta-règles:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Récupérer toutes les méta-règles
app.get('/api/admin/meta-rules', requireAdmin, async (req, res) => {
    try {
        const rules = await db.query(`
            SELECT mr.*, u.nom, u.prenom 
            FROM meta_rules mr 
            LEFT JOIN users u ON mr.created_by = u.id 
            ORDER BY mr.licence_type, mr.jour_source
        `);
        res.json(rules);
    } catch (err) {
        console.error('Erreur récupération méta-règles:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Créer une nouvelle méta-règle
app.post('/api/admin/meta-rules', requireAdmin, async (req, res) => {
    const { licence_type, jour_source, jours_interdits, description } = req.body;
    const userId = req.session.userId;

    if (!licence_type || jour_source === undefined || !jours_interdits) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    try {
        await db.run(`
            INSERT INTO meta_rules (licence_type, jour_source, jours_interdits, description, created_by) 
            VALUES (?, ?, ?, ?, ?)
        `, [licence_type, jour_source, jours_interdits, description, userId]);

        res.json({ message: 'Méta-règle créée avec succès' });
    } catch (err) {
        console.error('Erreur création méta-règle:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Modifier une méta-règle
app.put('/api/admin/meta-rules/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { licence_type, jour_source, jours_interdits, description } = req.body;

    if (!licence_type || jour_source === undefined || !jours_interdits) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    try {
        await db.run(`
            UPDATE meta_rules 
            SET licence_type = ?, jour_source = ?, jours_interdits = ?, description = ?
            WHERE id = ?
        `, [licence_type, jour_source, jours_interdits, description, id]);

        res.json({ message: 'Méta-règle modifiée avec succès' });
    } catch (err) {
        console.error('Erreur modification méta-règle:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Supprimer une méta-règle
app.delete('/api/admin/meta-rules/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        await db.run(`DELETE FROM meta_rules WHERE id = ?`, [id]);
        res.json({ message: 'Méta-règle supprimée' });
    } catch (err) {
        console.error('Erreur suppression méta-règle:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Activer/désactiver une méta-règle
app.put('/api/admin/meta-rules/:id/toggle', requireAdmin, async (req, res) => {
    const { id } = req.params;

    try {
        await db.run(`UPDATE meta_rules SET active = NOT active WHERE id = ?`, [id]);
        res.json({ message: 'Statut de la règle mis à jour' });
    } catch (err) {
        console.error('Erreur toggle méta-règle:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route de création de créneaux (ADMIN)
app.post('/api/creneaux', requireAdmin, async (req, res) => {
    const { nom, jour_semaine, heure_debut, heure_fin, nombre_lignes, personnes_par_ligne, licences_autorisees } = req.body;

    if (!nom || jour_semaine === undefined || !heure_debut || !heure_fin || !nombre_lignes || !personnes_par_ligne) {
        return res.status(400).json({ error: 'Tous les champs sont requis (nom, jour, horaires, nombre_lignes, personnes_par_ligne)' });
    }

    try {
        const capaciteMaxCalculee = parseInt(nombre_lignes) * parseInt(personnes_par_ligne);

        const sql = db.isPostgres ?
            `INSERT INTO creneaux (nom, jour_semaine, heure_debut, heure_fin, nombre_lignes, personnes_par_ligne, capacite_max, licences_autorisees) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id` :
            `INSERT INTO creneaux (nom, jour_semaine, heure_debut, heure_fin, nombre_lignes, personnes_par_ligne, capacite_max, licences_autorisees) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

        const result = await db.run(sql, [
            nom,
            jour_semaine,
            heure_debut,
            heure_fin,
            parseInt(nombre_lignes),
            parseInt(personnes_par_ligne),
            capaciteMaxCalculee,
            licences_autorisees || 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles'
        ]);

        res.json({
            message: 'Créneau créé avec succès',
            creneauId: result.lastID || result.id
        });
    } catch (err) {
        console.error('Erreur création créneau:', err);
        return res.status(500).json({ error: 'Erreur lors de la création du créneau' });
    }
});


// Route de modification de créneaux (ADMIN)
app.put('/api/creneaux/:creneauId', requireAdmin, async (req, res) => {
    const creneauId = req.params.creneauId;
    const { nom, jour_semaine, heure_debut, heure_fin, nombre_lignes, personnes_par_ligne, licences_autorisees } = req.body;

    if (!nom || jour_semaine === undefined || !heure_debut || !heure_fin || !nombre_lignes || !personnes_par_ligne) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    try {
        const capaciteMaxCalculee = parseInt(nombre_lignes) * parseInt(personnes_par_ligne);

        const sql = db.isPostgres ?
            `UPDATE creneaux SET nom = $1, jour_semaine = $2, heure_debut = $3, heure_fin = $4, nombre_lignes = $5, personnes_par_ligne = $6, capacite_max = $7, licences_autorisees = $8 WHERE id = $9` :
            `UPDATE creneaux SET nom = ?, jour_semaine = ?, heure_debut = ?, heure_fin = ?, nombre_lignes = ?, personnes_par_ligne = ?, capacite_max = ?, licences_autorisees = ? WHERE id = ?`;

        const result = await db.run(sql, [
            nom,
            jour_semaine,
            heure_debut,
            heure_fin,
            parseInt(nombre_lignes),
            parseInt(personnes_par_ligne),
            capaciteMaxCalculee,
            licences_autorisees || 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles',
            creneauId
        ]);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Créneau non trouvé' });
        }

        res.json({ message: 'Créneau modifié avec succès' });
    } catch (err) {
        console.error('Erreur modification créneau:', err);
        return res.status(500).json({ error: 'Erreur lors de la modification du créneau' });
    }
});


// Route de suppression de créneaux (ADMIN)
app.delete('/api/creneaux/:creneauId', requireAdmin, async (req, res) => {
    const creneauId = req.params.creneauId;

    console.log('Tentative de suppression du créneau:', creneauId);

    try {
        // Vérifier d'abord s'il y a des inscriptions
        const result = await db.get(`SELECT COUNT(*) as count FROM inscriptions WHERE creneau_id = ?`, [creneauId]);

        if (result && result.count > 0) {
            return res.status(400).json({
                error: `Impossible de supprimer ce créneau car ${result.count} personne(s) y sont inscrites. Veuillez d'abord les désinscrire.`
            });
        }

        // Supprimer le créneau s'il n'y a pas d'inscriptions
        const deleteResult = await db.run(`DELETE FROM creneaux WHERE id = ?`, [creneauId]);

        if (deleteResult.changes === 0) {
            return res.status(404).json({ error: 'Créneau non trouvé' });
        }

        console.log('Créneau supprimé avec succès:', creneauId);
        res.json({ message: 'Créneau supprimé avec succès' });
    } catch (err) {
        console.error('Erreur lors de la suppression:', err);
        res.status(500).json({ error: 'Erreur lors de la suppression du créneau' });
    }
});

// Route pour forcer la suppression d'un créneau (avec ses inscriptions)
app.delete('/api/creneaux/:creneauId/force', requireAdmin, async (req, res) => {
    const creneauId = req.params.creneauId;

    console.log('Suppression forcée du créneau:', creneauId);

    try {
        // Supprimer d'abord toutes les inscriptions
        await db.run(`DELETE FROM inscriptions WHERE creneau_id = ?`, [creneauId]);

        // Puis supprimer le créneau
        const deleteResult = await db.run(`DELETE FROM creneaux WHERE id = ?`, [creneauId]);

        if (deleteResult.changes === 0) {
            return res.status(404).json({ error: 'Créneau non trouvé' });
        }

        console.log('Créneau et inscriptions supprimés avec succès:', creneauId);
        res.json({ message: 'Créneau et toutes ses inscriptions supprimés avec succès' });
    } catch (err) {
        console.error('Erreur lors de la suppression:', err);
        res.status(500).json({ error: 'Erreur lors de la suppression du créneau' });
    }
});

// Routes d'administration des utilisateurs
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    const query = `
        SELECT id, email, nom, prenom, role, licence_type, created_at,
               (SELECT COUNT(*) FROM inscriptions WHERE user_id = users.id) as nb_inscriptions
        FROM users 
        ORDER BY created_at DESC
    `;

    try {
        const rows = await db.query(query, []);
        res.json(rows);
    } catch (err) {
        console.error('Erreur lors de la récupération des utilisateurs:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs' });
    }
});

app.put('/api/admin/users/:userId/role', requireAdmin, async (req, res) => {
    const userId = req.params.userId;
    const { role } = req.body;

    console.log('Modification du rôle utilisateur:', userId, 'vers', role);

    if (!role || !['membre', 'admin'].includes(role)) {
        return res.status(400).json({ error: 'Rôle invalide. Doit être "membre" ou "admin"' });
    }

    // Empêcher de se retirer ses propres droits admin
    if (req.session.userId == userId && role === 'membre') {
        return res.status(400).json({ error: 'Vous ne pouvez pas retirer vos propres droits administrateur' });
    }

    try {
        const sql = db.isPostgres ?
            `UPDATE users SET role = $1 WHERE id = $2` :
            `UPDATE users SET role = ? WHERE id = ?`;

        const result = await db.run(sql, [role, userId]);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        console.log('Rôle modifié avec succès pour l\'utilisateur:', userId);
        res.json({ message: `Rôle modifié vers "${role}" avec succès` });
    } catch (err) {
        console.error('Erreur modification rôle:', err);
        return res.status(500).json({ error: 'Erreur lors de la modification du rôle' });
    }
});

// Route pour modifier le type de licence d'un utilisateur (ADMIN)
app.put('/api/admin/users/:userId/licence', requireAdmin, async (req, res) => {
    const userId = req.params.userId;
    const { licence_type } = req.body;

    console.log('Modification du type de licence utilisateur:', userId, 'vers', licence_type);

    const licencesValides = ['Compétition', 'Loisir/Senior', 'Benjamins/Junior', 'Poussins/Pupilles'];
    if (!licence_type || !licencesValides.includes(licence_type)) {
        return res.status(400).json({
            error: 'Type de licence invalide. Doit être: ' + licencesValides.join(', ')
        });
    }

    try {
        const sql = db.isPostgres ?
            `UPDATE users SET licence_type = $1 WHERE id = $2` :
            `UPDATE users SET licence_type = ? WHERE id = ?`;

        const result = await db.run(sql, [licence_type, userId]);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        console.log('Type de licence modifié avec succès pour l\'utilisateur:', userId);
        res.json({ message: `Type de licence modifié vers "${licence_type}" avec succès` });
    } catch (err) {
        console.error('Erreur modification licence:', err);
        return res.status(500).json({ error: 'Erreur lors de la modification du type de licence' });
    }
});

// Route pour réinitialiser le mot de passe d'un utilisateur (ADMIN)
app.put('/api/admin/users/:userId/reset-password', requireAdmin, async (req, res) => {
    const userId = req.params.userId;
    const { nouveauMotDePasse } = req.body;

    console.log('Réinitialisation mot de passe pour utilisateur:', userId);

    if (!nouveauMotDePasse) {
        return res.status(400).json({ error: 'Nouveau mot de passe requis' });
    }

    if (nouveauMotDePasse.length < 6) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }

    try {
        // Hasher le nouveau mot de passe
        const hashedPassword = bcrypt.hashSync(nouveauMotDePasse, 10);

        // Mettre à jour le mot de passe
        const sql = db.isPostgres ?
            `UPDATE users SET password = $1 WHERE id = $2` :
            `UPDATE users SET password = ? WHERE id = ?`;

        const result = await db.run(sql, [hashedPassword, userId]);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        console.log('Mot de passe réinitialisé avec succès pour l\'utilisateur:', userId);
        res.json({ message: 'Mot de passe réinitialisé avec succès' });
    } catch (err) {
        console.error('Erreur réinitialisation mot de passe:', err);
        return res.status(500).json({ error: 'Erreur lors de la réinitialisation du mot de passe' });
    }
});

app.delete('/api/admin/users/:userId', requireAdmin, async (req, res) => {
    const userId = req.params.userId;

    console.log('Tentative de suppression de l\'utilisateur:', userId);

    // Empêcher de se supprimer soi-même
    if (req.session.userId == userId) {
        return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
    }

    try {
        // Vérifier s'il y a des inscriptions
        const result = await db.get(`SELECT COUNT(*) as count FROM inscriptions WHERE user_id = ?`, [userId]);

        if (result && result.count > 0) {
            return res.status(400).json({
                error: `Impossible de supprimer cet utilisateur car il a ${result.count} inscription(s) active(s). Veuillez d'abord le désinscrire de tous les créneaux.`
            });
        }

        // Supprimer l'utilisateur
        const deleteResult = await db.run(`DELETE FROM users WHERE id = ?`, [userId]);

        if (deleteResult.changes === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        console.log('Utilisateur supprimé avec succès:', userId);
        res.json({ message: 'Utilisateur supprimé avec succès' });
    } catch (err) {
        console.error('Erreur lors de la suppression:', err);
        res.status(500).json({ error: 'Erreur lors de la suppression de l\'utilisateur' });
    }
});



// Endpoint pour récupérer les méta-règles applicables à l'utilisateur
app.get('/api/mes-meta-regles', requireAuth, async (req, res) => {
    const userId = req.session.userId;

    try {
        // Vérifier si les méta-règles sont activées
        const config = await db.get(`SELECT enabled FROM meta_rules_config ORDER BY id DESC LIMIT 1`);

        if (!config || !config.enabled) {
            return res.json({ enabled: false, rules: [] });
        }

        // Récupérer le type de licence de l'utilisateur
        const userInfo = await db.get(`SELECT licence_type FROM users WHERE id = ?`, [userId]);

        if (!userInfo) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        // Récupérer les méta-règles actives pour ce type de licence
        const metaRegles = await db.query(`
            SELECT jour_source, jours_interdits, description 
            FROM meta_rules 
            WHERE licence_type = ? AND active = true
            ORDER BY jour_source
        `, [userInfo.licence_type]);

        // Formater les règles pour l'affichage
        const reglesFormatees = metaRegles.map(regle => {
            let joursInterdits;
            try {
                joursInterdits = JSON.parse(regle.jours_interdits);
            } catch (e) {
                joursInterdits = regle.jours_interdits.split(',').map(j => parseInt(j.trim()));
            }

            const joursNoms = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

            return {
                jourSource: regle.jour_source,
                jourSourceNom: joursNoms[regle.jour_source],
                joursInterdits: joursInterdits,
                joursInterditsNoms: joursInterdits.map(j => joursNoms[j]),
                description: regle.description
            };
        });

        res.json({
            enabled: true,
            licenceType: userInfo.licence_type,
            rules: reglesFormatees
        });
    } catch (err) {
        console.error('Erreur récupération méta-règles utilisateur:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/mes-limites', requireAuth, async (req, res) => {
    const userId = req.session.userId;

    try {
        const limites = await verifierLimitesSeances(db, userId);
        res.json(limites);
    } catch (err) {
        console.error('Erreur vérification limites:', err);
        return res.status(500).json({ error: 'Erreur lors de la vérification des limites' });
    }
});

// Route pour récupérer le profil utilisateur
app.get('/api/mon-profil', requireAuth, async (req, res) => {
    const userId = req.session.userId;

    try {
        const sql = db.isPostgres ?
            `SELECT id, email, nom, prenom, licence_type, created_at FROM users WHERE id = $1` :
            `SELECT id, email, nom, prenom, licence_type, created_at FROM users WHERE id = ?`;

        const user = await db.get(sql, [userId]);

        if (!user) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        res.json(user);
    } catch (err) {
        console.error('Erreur récupération profil:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération du profil' });
    }
});

// Route pour modifier le profil utilisateur
app.put('/api/mon-profil', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const { nom, prenom, email } = req.body;

    console.log('Modification profil utilisateur:', userId, { nom, prenom, email });

    if (!nom || !prenom || !email) {
        return res.status(400).json({ error: 'Nom, prénom et email sont requis' });
    }

    // Validation email basique
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Format d\'email invalide' });
    }

    try {
        // Vérifier si l'email n'est pas déjà utilisé par un autre utilisateur
        const checkEmailSql = db.isPostgres ?
            `SELECT id FROM users WHERE email = $1 AND id != $2` :
            `SELECT id FROM users WHERE email = ? AND id != ?`;

        const existingUser = await db.get(checkEmailSql, [email, userId]);

        if (existingUser) {
            return res.status(400).json({ error: 'Cet email est déjà utilisé par un autre utilisateur' });
        }

        // Mettre à jour le profil
        const updateSql = db.isPostgres ?
            `UPDATE users SET nom = $1, prenom = $2, email = $3 WHERE id = $4` :
            `UPDATE users SET nom = ?, prenom = ?, email = ? WHERE id = ?`;

        const result = await db.run(updateSql, [nom, prenom, email, userId]);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        // Mettre à jour le nom dans la session
        req.session.userName = `${prenom} ${nom}`;

        console.log('Profil modifié avec succès:', userId);
        res.json({ message: 'Profil modifié avec succès' });
    } catch (err) {
        console.error('Erreur modification profil:', err);
        return res.status(500).json({ error: 'Erreur lors de la modification du profil' });
    }
});

// Route pour changer le mot de passe
app.put('/api/changer-mot-de-passe', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const { motDePasseActuel, nouveauMotDePasse, confirmerMotDePasse } = req.body;

    console.log('Changement mot de passe pour utilisateur:', userId);

    if (!motDePasseActuel || !nouveauMotDePasse || !confirmerMotDePasse) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    if (nouveauMotDePasse !== confirmerMotDePasse) {
        return res.status(400).json({ error: 'Les nouveaux mots de passe ne correspondent pas' });
    }

    if (nouveauMotDePasse.length < 6) {
        return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 6 caractères' });
    }

    try {
        // Récupérer le mot de passe actuel
        const sql = db.isPostgres ?
            `SELECT password FROM users WHERE id = $1` :
            `SELECT password FROM users WHERE id = ?`;

        const user = await db.get(sql, [userId]);

        if (!user) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        // Vérifier le mot de passe actuel
        if (!bcrypt.compareSync(motDePasseActuel, user.password)) {
            return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
        }

        // Hasher le nouveau mot de passe
        const hashedPassword = bcrypt.hashSync(nouveauMotDePasse, 10);

        // Mettre à jour le mot de passe
        const updateSql = db.isPostgres ?
            `UPDATE users SET password = $1 WHERE id = $2` :
            `UPDATE users SET password = ? WHERE id = ?`;

        await db.run(updateSql, [hashedPassword, userId]);

        console.log('Mot de passe changé avec succès:', userId);
        res.json({ message: 'Mot de passe changé avec succès' });
    } catch (err) {
        console.error('Erreur changement mot de passe:', err);
        return res.status(500).json({ error: 'Erreur lors du changement de mot de passe' });
    }
});

// ===== ROUTES CRUD BLOCS (ADMIN) =====

// GET : liste des blocs avec leurs créneaux
app.get('/api/admin/blocs', requireAdmin, async (req, res) => {
    try {
        const blocs = await db.query(`SELECT * FROM blocs ORDER BY ordre, nom`);
        for (const bloc of blocs) {
            const creneauxSql = db.isPostgres ?
                `SELECT c.id, c.nom, c.jour_semaine, c.heure_debut, c.heure_fin, c.nombre_lignes, c.personnes_par_ligne
                 FROM creneaux c JOIN bloc_creneaux bc ON c.id = bc.creneau_id
                 WHERE bc.bloc_id = $1 ORDER BY c.jour_semaine, c.heure_debut` :
                `SELECT c.id, c.nom, c.jour_semaine, c.heure_debut, c.heure_fin, c.nombre_lignes, c.personnes_par_ligne
                 FROM creneaux c JOIN bloc_creneaux bc ON c.id = bc.creneau_id
                 WHERE bc.bloc_id = ? ORDER BY c.jour_semaine, c.heure_debut`;
            bloc.creneaux = await db.query(creneauxSql, [bloc.id]);
            bloc.nb_creneaux = bloc.creneaux.length;
        }
        res.json(blocs);
    } catch (err) {
        console.error('Erreur récupération blocs:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// GET : un bloc spécifique
app.get('/api/admin/blocs/:blocId', requireAdmin, async (req, res) => {
    const { blocId } = req.params;
    try {
        const sql = db.isPostgres ? `SELECT * FROM blocs WHERE id = $1` : `SELECT * FROM blocs WHERE id = ?`;
        const bloc = await db.get(sql, [blocId]);
        if (!bloc) return res.status(404).json({ error: 'Bloc non trouvé' });
        res.json(bloc);
    } catch (err) {
        console.error('Erreur récupération bloc:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// GET : créneaux d'un bloc
app.get('/api/admin/blocs/:blocId/creneaux', requireAdmin, async (req, res) => {
    const { blocId } = req.params;
    try {
        const sql = db.isPostgres ?
            `SELECT c.* FROM creneaux c JOIN bloc_creneaux bc ON c.id = bc.creneau_id WHERE bc.bloc_id = $1` :
            `SELECT c.* FROM creneaux c JOIN bloc_creneaux bc ON c.id = bc.creneau_id WHERE bc.bloc_id = ?`;
        const creneaux = await db.query(sql, [blocId]);
        res.json(creneaux);
    } catch (err) {
        console.error('Erreur récupération créneaux du bloc:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// POST : créer un bloc
app.post('/api/admin/blocs', requireAdmin, async (req, res) => {
    const { nom, description, ordre } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom du bloc est requis' });
    try {
        const sql = db.isPostgres ?
            `INSERT INTO blocs (nom, description, ordre) VALUES ($1, $2, $3) RETURNING id` :
            `INSERT INTO blocs (nom, description, ordre) VALUES (?, ?, ?)`;
        const result = await db.run(sql, [nom, description || '', parseInt(ordre) || 0]);
        res.json({ message: 'Bloc créé', blocId: result.lastID || result.id });
    } catch (err) {
        console.error('Erreur création bloc:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// PUT : modifier un bloc
app.put('/api/admin/blocs/:blocId', requireAdmin, async (req, res) => {
    const { blocId } = req.params;
    const { nom, description, ordre } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom du bloc est requis' });
    try {
        const sql = db.isPostgres ?
            `UPDATE blocs SET nom = $1, description = $2, ordre = $3 WHERE id = $4` :
            `UPDATE blocs SET nom = ?, description = ?, ordre = ? WHERE id = ?`;
        const result = await db.run(sql, [nom, description || '', parseInt(ordre) || 0, blocId]);
        if (result.changes === 0) return res.status(404).json({ error: 'Bloc non trouvé' });
        res.json({ message: 'Bloc modifié' });
    } catch (err) {
        console.error('Erreur modification bloc:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// PUT : mettre à jour les créneaux d'un bloc
app.put('/api/admin/blocs/:blocId/creneaux', requireAdmin, async (req, res) => {
    const { blocId } = req.params;
    const { creneauxIds } = req.body;

    if (!Array.isArray(creneauxIds)) {
        return res.status(400).json({ error: 'creneauxIds doit être un tableau' });
    }

    try {
        // Supprimer toutes les associations existantes
        const deleteSql = db.isPostgres ?
            `DELETE FROM bloc_creneaux WHERE bloc_id = $1` :
            `DELETE FROM bloc_creneaux WHERE bloc_id = ?`;
        await db.run(deleteSql, [blocId]);

        // Ajouter les nouvelles associations
        for (const creneauId of creneauxIds) {
            const insertSql = db.isPostgres ?
                `INSERT INTO bloc_creneaux (bloc_id, creneau_id) VALUES ($1, $2)` :
                `INSERT INTO bloc_creneaux (bloc_id, creneau_id) VALUES (?, ?)`;
            await db.run(insertSql, [blocId, creneauId]);
        }

        res.json({ message: 'Créneaux du bloc mis à jour' });
    } catch (err) {
        console.error('Erreur mise à jour créneaux du bloc:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// DELETE : supprimer un bloc
app.delete('/api/admin/blocs/:blocId', requireAdmin, async (req, res) => {
    const { blocId } = req.params;
    try {
        // ON DELETE CASCADE gère la table bloc_creneaux
        const sql = db.isPostgres ? `DELETE FROM blocs WHERE id = $1` : `DELETE FROM blocs WHERE id = ?`;
        const result = await db.run(sql, [blocId]);
        if (result.changes === 0) return res.status(404).json({ error: 'Bloc non trouvé' });
        res.json({ message: 'Bloc supprimé' });
    } catch (err) {
        console.error('Erreur suppression bloc:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// POST : associer un créneau à un bloc
app.post('/api/admin/blocs/:blocId/creneaux/:creneauId', requireAdmin, async (req, res) => {
    const { blocId, creneauId } = req.params;
    try {
        const sql = db.isPostgres ?
            `INSERT INTO bloc_creneaux (bloc_id, creneau_id) VALUES ($1, $2) ON CONFLICT DO NOTHING` :
            `INSERT OR IGNORE INTO bloc_creneaux (bloc_id, creneau_id) VALUES (?, ?)`;
        await db.run(sql, [blocId, creneauId]);
        res.json({ message: 'Créneau associé au bloc' });
    } catch (err) {
        console.error('Erreur association créneau-bloc:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// DELETE : détacher un créneau d'un bloc
app.delete('/api/admin/blocs/:blocId/creneaux/:creneauId', requireAdmin, async (req, res) => {
    const { blocId, creneauId } = req.params;
    try {
        const sql = db.isPostgres ?
            `DELETE FROM bloc_creneaux WHERE bloc_id = $1 AND creneau_id = $2` :
            `DELETE FROM bloc_creneaux WHERE bloc_id = ? AND creneau_id = ?`;
        await db.run(sql, [blocId, creneauId]);
        res.json({ message: 'Créneau retiré du bloc' });
    } catch (err) {
        console.error('Erreur suppression association créneau-bloc:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// GET : liste des créneaux non encore associés à un bloc (pour le formulaire d'association)
app.get('/api/admin/creneaux-sans-bloc', requireAdmin, async (req, res) => {
    try {
        const sql = `
            SELECT c.id, c.nom, c.jour_semaine, c.heure_debut, c.heure_fin
            FROM creneaux c
            WHERE c.id NOT IN (SELECT creneau_id FROM bloc_creneaux)
            AND c.actif = ${db.isPostgres ? 'true' : '1'}
            ORDER BY c.jour_semaine, c.heure_debut
        `;
        const rows = await db.query(sql, []);
        res.json(rows);
    } catch (err) {
        console.error('Erreur récupération créneaux sans bloc:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Routes d'administration des créneaux
app.get('/api/admin/inscriptions/:creneauId', requireAdmin, async (req, res) => {
    const creneauId = req.params.creneauId;

    const query = db.isPostgres ? `
        SELECT i.*, u.nom, u.prenom, u.email
        FROM inscriptions i
        JOIN users u ON i.user_id = u.id
        WHERE i.creneau_id = $1
        ORDER BY 
            CASE WHEN i.statut = 'inscrit' THEN 0 ELSE 1 END,
            i.position_attente ASC,
            i.created_at ASC
    ` : `
        SELECT i.*, u.nom, u.prenom, u.email
        FROM inscriptions i
        JOIN users u ON i.user_id = u.id
        WHERE i.creneau_id = ?
        ORDER BY 
            CASE WHEN i.statut = 'inscrit' THEN 0 ELSE 1 END,
            i.position_attente ASC,
            i.created_at ASC
    `;

    try {
        const rows = await db.query(query, [creneauId]);
        res.json(rows);
    } catch (err) {
        console.error('Erreur récupération inscriptions:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des inscriptions' });
    }
});

// Route pour inscrire un utilisateur à un créneau (ADMIN)
app.post('/api/admin/inscriptions', requireAdmin, async (req, res) => {
    const { email, creneauId } = req.body;

    console.log('Admin inscription:', { email, creneauId });

    if (!email || !creneauId) {
        return res.status(400).json({ error: 'Email et ID du créneau requis' });
    }

    try {
        // Trouver l'utilisateur par email
        const userSql = db.isPostgres ?
            `SELECT id FROM users WHERE email = $1` :
            `SELECT id FROM users WHERE email = ?`;

        const user = await db.get(userSql, [email]);

        if (!user) {
            return res.status(404).json({ error: 'Utilisateur non trouvé avec cet email' });
        }

        // Vérifier si déjà inscrit
        const checkSql = db.isPostgres ?
            `SELECT * FROM inscriptions WHERE user_id = $1 AND creneau_id = $2` :
            `SELECT * FROM inscriptions WHERE user_id = ? AND creneau_id = ?`;

        const existingInscription = await db.get(checkSql, [user.id, creneauId]);

        if (existingInscription) {
            return res.status(400).json({ error: 'Cet utilisateur est déjà inscrit à ce créneau' });
        }

        // Vérifier les méta-règles (avec avertissement pour l'admin)
        const metaReglesCheck = await verifierMetaRegles(db, user.id, creneauId);

        if (!metaReglesCheck.autorise) {
            // Pour l'admin, on retourne un avertissement mais on permet l'inscription
            console.log('⚠️ Admin outrepasse méta-règle:', metaReglesCheck.message);
        }

        // Inscrire l'utilisateur (inscription directe par l'admin)
        const insertSql = db.isPostgres ?
            `INSERT INTO inscriptions (user_id, creneau_id, statut) VALUES ($1, $2, 'inscrit') RETURNING id` :
            `INSERT INTO inscriptions (user_id, creneau_id, statut) VALUES (?, ?, 'inscrit')`;

        await db.run(insertSql, [user.id, creneauId]);

        console.log('Inscription admin réussie:', { email, creneauId });

        let message = `Utilisateur ${email} inscrit avec succès`;
        if (!metaReglesCheck.autorise) {
            message += ` (Avertissement: ${metaReglesCheck.message})`;
        }

        res.json({ message });
    } catch (err) {
        console.error('Erreur inscription admin:', err);
        return res.status(500).json({ error: 'Erreur lors de l\'inscription' });
    }
});

// Route pour désinscrire un utilisateur d'un créneau (ADMIN)
app.delete('/api/admin/inscriptions/:userId/:creneauId', requireAdmin, async (req, res) => {
    const { userId, creneauId } = req.params;

    console.log('Admin désinscription:', { userId, creneauId });

    try {
        // Vérifier l'inscription existante
        const checkSql = db.isPostgres ?
            `SELECT * FROM inscriptions WHERE user_id = $1 AND creneau_id = $2` :
            `SELECT * FROM inscriptions WHERE user_id = ? AND creneau_id = ?`;

        const inscription = await db.get(checkSql, [userId, creneauId]);

        if (!inscription) {
            return res.status(404).json({ error: 'Inscription non trouvée' });
        }

        // Supprimer l'inscription
        const deleteSql = db.isPostgres ?
            `DELETE FROM inscriptions WHERE user_id = $1 AND creneau_id = $2` :
            `DELETE FROM inscriptions WHERE user_id = ? AND creneau_id = ?`;

        await db.run(deleteSql, [userId, creneauId]);

        console.log('Désinscription admin réussie:', { userId, creneauId });
        res.json({ message: 'Utilisateur désinscrit avec succès' });
    } catch (err) {
        console.error('Erreur désinscription admin:', err);
        return res.status(500).json({ error: 'Erreur lors de la désinscription' });
    }
});

// Route pour promouvoir un utilisateur de la liste d'attente (ADMIN)
app.put('/api/admin/inscriptions/:userId/:creneauId/promote', requireAdmin, async (req, res) => {
    const { userId, creneauId } = req.params;

    console.log('Admin promotion:', { userId, creneauId });

    try {
        // Vérifier que l'utilisateur est en attente
        const checkSql = db.isPostgres ?
            `SELECT * FROM inscriptions WHERE user_id = $1 AND creneau_id = $2 AND statut = 'attente'` :
            `SELECT * FROM inscriptions WHERE user_id = ? AND creneau_id = ? AND statut = 'attente'`;

        const inscription = await db.get(checkSql, [userId, creneauId]);

        if (!inscription) {
            return res.status(404).json({ error: 'Utilisateur non trouvé en liste d\'attente' });
        }

        // Promouvoir l'utilisateur
        const promoteSql = db.isPostgres ?
            `UPDATE inscriptions SET statut = 'inscrit', position_attente = NULL WHERE user_id = $1 AND creneau_id = $2` :
            `UPDATE inscriptions SET statut = 'inscrit', position_attente = NULL WHERE user_id = ? AND creneau_id = ?`;

        await db.run(promoteSql, [userId, creneauId]);

        console.log('Promotion admin réussie:', { userId, creneauId });
        res.json({ message: 'Utilisateur promu avec succès' });
    } catch (err) {
        console.error('Erreur promotion admin:', err);
        return res.status(500).json({ error: 'Erreur lors de la promotion' });
    }
});

// Route d'inscription à un créneau
app.post('/api/inscriptions', requireAuth, async (req, res) => {
    const { creneauId } = req.body;
    const userId = req.session.userId;

    console.log('Tentative d\'inscription:', { userId, creneauId });

    if (!creneauId) {
        return res.status(400).json({ error: 'ID du créneau requis' });
    }

    try {
        // Vérifier si l'utilisateur est déjà inscrit
        const sql = db.isPostgres ?
            `SELECT * FROM inscriptions WHERE user_id = $1 AND creneau_id = $2` :
            `SELECT * FROM inscriptions WHERE user_id = ? AND creneau_id = ?`;

        const existingInscription = await db.get(sql, [userId, creneauId]);

        if (existingInscription) {
            return res.status(400).json({ error: 'Vous êtes déjà inscrit à ce créneau' });
        }

        // Vérifier les limites de séances
        const limites = await verifierLimitesSeances(db, userId);

        if (limites.limiteAtteinte) {
            return res.status(400).json({
                error: `Vous avez atteint votre limite de ${limites.maxSeances} séances par semaine (${limites.seancesActuelles}/${limites.maxSeances})`
            });
        }

        // Vérifier la règle de bloc (1 séance par bloc maximum)
        const regleBloc = await verifierRegleBloc(db, userId, creneauId);

        if (!regleBloc.autorise) {
            return res.status(400).json({
                error: regleBloc.message
            });
        }

        // Vérifier la capacité du créneau et les inscriptions actuelles
        const creneauSql = db.isPostgres ?
            `SELECT c.nombre_lignes, c.personnes_par_ligne, c.nom,
                    (c.nombre_lignes * c.personnes_par_ligne) as capacite_max,
                    COUNT(i.id) as inscrits_actuels
             FROM creneaux c
             LEFT JOIN inscriptions i ON c.id = i.creneau_id AND i.statut = 'inscrit'
             WHERE c.id = $1
             GROUP BY c.id, c.nombre_lignes, c.personnes_par_ligne, c.nom` :
            `SELECT c.nombre_lignes, c.personnes_par_ligne, c.nom,
                    (c.nombre_lignes * c.personnes_par_ligne) as capacite_max,
                    COUNT(i.id) as inscrits_actuels
             FROM creneaux c
             LEFT JOIN inscriptions i ON c.id = i.creneau_id AND i.statut = 'inscrit'
             WHERE c.id = ?
             GROUP BY c.id, c.nombre_lignes, c.personnes_par_ligne, c.nom`;

        const creneauInfo = await db.get(creneauSql, [creneauId]);

        if (!creneauInfo) {
            return res.status(404).json({ error: 'Créneau non trouvé' });
        }

        const inscritActuels = parseInt(creneauInfo.inscrits_actuels) || 0;
        const capaciteMax = parseInt(creneauInfo.capacite_max);

        // Déterminer le statut d'inscription
        let statut = 'inscrit';
        let positionAttente = null;
        let message = `Inscription réussie au créneau "${creneauInfo.nom}" ! Il vous reste ${limites.seancesRestantes - 1} séance(s) cette semaine.`;

        if (inscritActuels >= capaciteMax) {
            // Créneau complet, mettre en liste d'attente
            statut = 'attente';

            // Obtenir la prochaine position sur la liste d'attente
            const positionSql = db.isPostgres ?
                `SELECT COALESCE(MAX(position_attente), 0) + 1 as next_pos 
                 FROM inscriptions 
                 WHERE creneau_id = $1 AND statut = 'attente'` :
                `SELECT COALESCE(MAX(position_attente), 0) + 1 as next_pos 
                 FROM inscriptions 
                 WHERE creneau_id = ? AND statut = 'attente'`;

            const posResult = await db.get(positionSql, [creneauId]);
            positionAttente = posResult.next_pos;

            message = `Créneau complet ! Vous avez été ajouté à la liste d'attente (position ${positionAttente}).`;
        }

        // Insérer l'inscription avec le bon statut
        const insertSql = db.isPostgres ?
            `INSERT INTO inscriptions (user_id, creneau_id, statut, position_attente) VALUES ($1, $2, $3, $4) RETURNING id` :
            `INSERT INTO inscriptions (user_id, creneau_id, statut, position_attente) VALUES (?, ?, ?, ?)`;

        const result = await db.run(insertSql, [userId, creneauId, statut, positionAttente]);

        console.log('Inscription réussie:', { userId, creneauId, statut, positionAttente, inscritActuels, capaciteMax });

        res.json({
            message,
            statut,
            positionAttente,
            inscriptionId: result.lastID || result.id,
            seancesRestantes: statut === 'inscrit' ? limites.seancesRestantes - 1 : limites.seancesRestantes
        });
    } catch (err) {
        console.error('Erreur inscription:', err);
        return res.status(500).json({ error: 'Erreur lors de l\'inscription' });
    }
});

// Route pour obtenir les infos du token (pour affichage)
app.get('/api/inscription-attente/info/:token', async (req, res) => {
    const { token } = req.params;

    try {
        const tokenInfo = await db.get(`
            SELECT u.email, u.nom, u.prenom, c.nom as creneau_nom, c.jour_semaine, c.heure_debut, c.heure_fin
            FROM waitlist_tokens wt
            JOIN users u ON wt.user_id = u.id
            JOIN creneaux c ON wt.creneau_id = c.id
            WHERE wt.token = ? AND wt.used = ? AND wt.expires_at > ?
        `, [token, false, new Date().toISOString()]);

        if (!tokenInfo) {
            return res.status(400).json({ error: 'Token invalide ou expiré' });
        }

        const jours = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

        res.json({
            user: `${tokenInfo.prenom} ${tokenInfo.nom}`,
            email: tokenInfo.email,
            creneau: tokenInfo.creneau_nom,
            jour: jours[tokenInfo.jour_semaine],
            horaire: `${tokenInfo.heure_debut} - ${tokenInfo.heure_fin}`
        });
    } catch (err) {
        console.error('Erreur info token:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route pour l'inscription via token de liste d'attente
app.post('/api/inscription-attente', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'Token manquant' });
    }

    try {
        // Vérifier le token
        const tokenInfo = await db.get(`
            SELECT wt.*, u.email, u.nom, u.prenom, c.nom as creneau_nom, c.capacite_max
            FROM waitlist_tokens wt
            JOIN users u ON wt.user_id = u.id
            JOIN creneaux c ON wt.creneau_id = c.id
            WHERE wt.token = ? AND wt.used = ? AND wt.expires_at > ?
        `, [token, false, new Date().toISOString()]);

        if (!tokenInfo) {
            return res.status(400).json({ error: 'Token invalide ou expiré' });
        }

        // Vérifier si l'utilisateur est toujours en liste d'attente
        const currentInscription = await db.get(`
            SELECT * FROM inscriptions 
            WHERE user_id = ? AND creneau_id = ? AND statut = 'attente'
        `, [tokenInfo.user_id, tokenInfo.creneau_id]);

        if (!currentInscription) {
            return res.status(400).json({ error: 'Vous n\'êtes plus en liste d\'attente pour ce créneau' });
        }

        // Vérifier s'il y a encore de la place (vérification en temps réel)
        const inscritActuels = await db.get(`
            SELECT COUNT(*) as count 
            FROM inscriptions 
            WHERE creneau_id = ? AND statut = 'inscrit'
        `, [tokenInfo.creneau_id]);

        if (inscritActuels.count >= tokenInfo.capacite_max) {
            return res.status(409).json({
                error: 'Désolé, quelqu\'un d\'autre a pris la place avant vous ! Le créneau est à nouveau complet.',
                tooLate: true
            });
        }

        // Promouvoir l'utilisateur
        await db.run(`
            UPDATE inscriptions 
            SET statut = 'inscrit', position_attente = NULL 
            WHERE user_id = ? AND creneau_id = ?
        `, [tokenInfo.user_id, tokenInfo.creneau_id]);

        // Marquer le token comme utilisé
        await db.run(`UPDATE waitlist_tokens SET used = ? WHERE token = ?`, [true, token]);

        // Invalider tous les autres tokens pour ce créneau pour éviter les tentatives inutiles
        await db.run(`UPDATE waitlist_tokens SET used = ? WHERE creneau_id = ? AND token != ?`, [true, tokenInfo.creneau_id, token]);

        // Réorganiser les positions d'attente
        await db.run(`
            UPDATE inscriptions 
            SET position_attente = position_attente - 1 
            WHERE creneau_id = ? AND statut = 'attente' AND position_attente > ?
        `, [tokenInfo.creneau_id, currentInscription.position_attente]);

        console.log(`✅ Inscription via token réussie: ${tokenInfo.email} -> ${tokenInfo.creneau_nom}`);

        res.json({
            message: `Inscription confirmée pour le créneau "${tokenInfo.creneau_nom}" !`,
            success: true,
            creneau: tokenInfo.creneau_nom
        });

    } catch (err) {
        console.error('Erreur inscription via token:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route de désinscription
app.delete('/api/inscriptions/:creneauId', requireAuth, async (req, res) => {
    const creneauId = req.params.creneauId;
    const userId = req.session.userId;

    console.log('Tentative de désinscription:', { userId, creneauId });

    try {
        // Vérifier l'inscription existante
        const checkSql = db.isPostgres ?
            `SELECT * FROM inscriptions WHERE user_id = $1 AND creneau_id = $2` :
            `SELECT * FROM inscriptions WHERE user_id = ? AND creneau_id = ?`;

        const inscription = await db.get(checkSql, [userId, creneauId]);

        if (!inscription) {
            return res.status(404).json({ error: 'Inscription non trouvée' });
        }

        // Supprimer l'inscription
        const deleteSql = db.isPostgres ?
            `DELETE FROM inscriptions WHERE user_id = $1 AND creneau_id = $2` :
            `DELETE FROM inscriptions WHERE user_id = ? AND creneau_id = ?`;

        await db.run(deleteSql, [userId, creneauId]);

        console.log('Désinscription réussie:', { userId, creneauId });

        // Si c'était un inscrit (pas en attente), notifier le premier de la liste d'attente
        if (inscription.statut === 'inscrit') {
            const premierEnAttenteSql = db.isPostgres ?
                `SELECT * FROM inscriptions 
                 WHERE creneau_id = $1 AND statut = 'attente' 
                 ORDER BY position_attente ASC LIMIT 1` :
                `SELECT * FROM inscriptions 
                 WHERE creneau_id = ? AND statut = 'attente' 
                 ORDER BY position_attente ASC LIMIT 1`;

            const premierEnAttente = await db.get(premierEnAttenteSql, [creneauId]);

            if (premierEnAttente) {
                // Récupérer TOUTES les personnes en liste d'attente
                const toutesPersonnesAttenteSql = db.isPostgres ?
                    `SELECT user_id FROM inscriptions 
                     WHERE creneau_id = $1 AND statut = 'attente' 
                     ORDER BY position_attente ASC` :
                    `SELECT user_id FROM inscriptions 
                     WHERE creneau_id = ? AND statut = 'attente' 
                     ORDER BY position_attente ASC`;

                const personnesEnAttente = await db.query(toutesPersonnesAttenteSql, [creneauId]);

                if (personnesEnAttente && personnesEnAttente.length > 0) {
                    console.log(`📧 Envoi d'emails à ${personnesEnAttente.length} personne(s) en liste d'attente`);

                    // Envoyer un email à chaque personne en liste d'attente
                    let emailsEnvoyes = 0;
                    for (const personne of personnesEnAttente) {
                        const emailSent = await notifyWaitlistUser(personne.user_id, creneauId);
                        if (emailSent) emailsEnvoyes++;
                    }

                    res.json({
                        message: `Désinscription réussie. ${emailsEnvoyes} personne(s) en liste d'attente ont été notifiées par email.`,
                        notification: true,
                        emailsEnvoyes
                    });
                } else {
                    res.json({ message: 'Désinscription réussie' });
                }
            } else {
                res.json({ message: 'Désinscription réussie' });
            }
        } else {
            // Si c'était quelqu'un en attente, réorganiser les positions
            if (inscription.position_attente) {
                const reorganiserSql = db.isPostgres ?
                    `UPDATE inscriptions 
                     SET position_attente = position_attente - 1 
                     WHERE creneau_id = $1 AND statut = 'attente' AND position_attente > $2` :
                    `UPDATE inscriptions 
                     SET position_attente = position_attente - 1 
                     WHERE creneau_id = ? AND statut = 'attente' AND position_attente > ?`;

                await db.run(reorganiserSql, [creneauId, inscription.position_attente]);
            }
            res.json({ message: 'Désinscription réussie' });
        }
    } catch (err) {
        console.error('Erreur désinscription:', err);
        return res.status(500).json({ error: 'Erreur lors de la désinscription' });
    }
});

// Routes d'administration des limites de licence
app.get('/api/admin/licence-limits', requireAdmin, async (req, res) => {
    try {
        const rows = await db.query(`SELECT * FROM licence_limits ORDER BY licence_type`, []);
        res.json(rows);
    } catch (err) {
        console.error('Erreur récupération limites:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des limites' });
    }
});

app.put('/api/admin/licence-limits/:licenceType', requireAdmin, async (req, res) => {
    const licenceType = req.params.licenceType;
    const { max_seances_semaine } = req.body;

    console.log('Modification limite licence:', licenceType, 'vers', max_seances_semaine);

    if (!max_seances_semaine || max_seances_semaine < 1 || max_seances_semaine > 10) {
        return res.status(400).json({ error: 'Le nombre de séances doit être entre 1 et 10' });
    }

    try {
        const sql = db.isPostgres ?
            `UPDATE licence_limits SET max_seances_semaine = $1 WHERE licence_type = $2` :
            `UPDATE licence_limits SET max_seances_semaine = ? WHERE licence_type = ?`;

        const result = await db.run(sql, [max_seances_semaine, licenceType]);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Type de licence non trouvé' });
        }

        console.log('Limite modifiée avec succès:', licenceType);
        res.json({ message: 'Limite modifiée avec succès' });
    } catch (err) {
        console.error('Erreur modification limite:', err);
        return res.status(500).json({ error: 'Erreur lors de la modification' });
    }
});

// Route de remise à zéro hebdomadaire (ADMIN)
app.post('/api/admin/reset-weekly', requireAdmin, async (req, res) => {
    console.log('🔄 Début de la remise à zéro hebdomadaire par admin:', req.session.userId);

    try {
        // Compter le nombre d'inscriptions avant suppression
        const countSql = `SELECT COUNT(*) as total FROM inscriptions`;
        const countResult = await db.get(countSql, []);
        const inscriptionsAvant = countResult.total || 0;

        console.log(`📊 Inscriptions à supprimer: ${inscriptionsAvant}`);

        // Supprimer toutes les inscriptions de tous les créneaux
        const deleteSql = `DELETE FROM inscriptions`;
        await db.run(deleteSql, []);

        // Vérifier que toutes les inscriptions ont été supprimées
        const verificationResult = await db.get(countSql, []);
        const inscriptionsApres = verificationResult.total || 0;

        console.log(`✅ Remise à zéro terminée: ${inscriptionsAvant} inscription(s) supprimée(s), ${inscriptionsApres} restante(s)`);

        // Log de sécurité
        console.log(`🔒 Remise à zéro hebdomadaire effectuée par l'admin ${req.session.userId} le ${new Date().toISOString()}`);

        res.json({
            message: 'Remise à zéro hebdomadaire réussie',
            inscriptionsSupprimes: inscriptionsAvant,
            inscriptionsRestantes: inscriptionsApres
        });
    } catch (err) {
        console.error('❌ Erreur lors de la remise à zéro hebdomadaire:', err);
        return res.status(500).json({ error: 'Erreur lors de la remise à zéro hebdomadaire' });
    }
});

// Route temporaire pour promouvoir un utilisateur en admin (À SUPPRIMER APRÈS USAGE)
app.post('/api/temp-promote-admin', async (req, res) => {
    const { email, secret } = req.body;

    // Mot de passe secret pour sécuriser cette route temporaire
    if (secret !== 'promote-me-to-admin-2024') {
        return res.status(403).json({ error: 'Secret incorrect' });
    }

    try {
        const sql = db.isPostgres ?
            `UPDATE users SET role = 'admin' WHERE email = $1` :
            `UPDATE users SET role = 'admin' WHERE email = ?`;

        const result = await db.run(sql, [email]);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        console.log(`🔑 Utilisateur ${email} promu administrateur`);
        res.json({ message: `Utilisateur ${email} promu administrateur avec succès` });
    } catch (err) {
        console.error('Erreur promotion admin:', err);
        return res.status(500).json({ error: 'Erreur lors de la promotion' });
    }
});