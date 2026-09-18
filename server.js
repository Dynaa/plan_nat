require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const DatabaseAdapter = require('./database');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const { verifierLimitesSeances, verifierRegleBloc, verifierMetaRegles } = require('./services/businessRules');
const importComptes = require('./services/importComptes');
const seances = require('./services/seances');
const semainesTypes = require('./services/semainesTypes');
const seancesAdmin = require('./services/seancesAdmin');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
// Un export de la fédération compte beaucoup de colonnes : l'import de comptes
// dépasse vite la limite par défaut (100 ko). Monté avant le parseur global,
// qui ignore ensuite un corps déjà lu.
app.use('/api/admin/users/import', bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Healthcheck pour Railway
app.get('/health', (req, res) => res.status(200).send('OK'));

// Base de données (instanciée tôt : le store de session en a besoin)
const db = new DatabaseAdapter();

// SESSION_SECRET est obligatoire en production
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    console.error('❌ SESSION_SECRET doit être définie en production (variable d\'environnement)');
    process.exit(1);
}

// Configuration de session adaptée à l'environnement
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'triathlon-natation-secret-key-dev',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Activé en production ci-dessous
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 heures
        sameSite: 'lax'
    }
};

// Sessions persistantes en PostgreSQL (survivent aux redéploiements)
// Désactivé en mode test (express-session y est mocké)
if (db.isPostgres && process.env.NODE_ENV !== 'test') {
    const PgStore = require('connect-pg-simple')(session);
    sessionConfig.store = new PgStore({
        pool: db.pool,
        createTableIfMissing: true
    });
    console.log('🐘 Store de session PostgreSQL activé');
}

if (process.env.NODE_ENV === 'production') {
    console.log('🔧 Configuration session pour Railway (production)');
    // Railway est derrière un proxy HTTPS : trust proxy permet secure: true
    app.set('trust proxy', 1);
    sessionConfig.cookie.secure = true;
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
    connectionTimeout: 10000, // 10 secondes
    greetingTimeout: 5000,
    socketTimeout: 10000
};

// Créer le transporteur email
let transporter;
let isEtherealTransport = false;
const initEmailTransporter = async () => {
    // Un fournisseur à API HTTPS rend le SMTP inutile. Sans ce court-circuit,
    // l'app perd 10 s en timeout au démarrage là où le SMTP sortant est bloqué.
    if (process.env.RESEND_API_KEY || process.env.BREVO_API_KEY) {
        console.log('📧 Fournisseur email HTTPS configuré : initialisation SMTP ignorée');
        return;
    }

    console.log('📧 Début initEmailTransporter...');
    console.log('📧 Variables SMTP:', {
        host: !!process.env.SMTP_HOST,
        user: !!process.env.SMTP_USER,
        pass: !!process.env.SMTP_PASS,
        nodeEnv: process.env.NODE_ENV
    });

    try {
        // Sans service email configuré, les mails partent vers Ethereal (bac à sable) : ils ne sont jamais délivrés
        if (process.env.NODE_ENV === 'production' && !process.env.RESEND_API_KEY && !process.env.SENDGRID_API_KEY && (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS)) {
            console.error('🚨 PRODUCTION SANS SERVICE EMAIL : aucun email ne sera réellement délivré');
            console.error('🚨 Définissez RESEND_API_KEY, ou SMTP_HOST + SMTP_USER + SMTP_PASS');
        }

        if (!process.env.SMTP_HOST) {
            console.log('📧 Pas de SMTP_HOST défini, création compte Ethereal (mode test)...');
            isEtherealTransport = true;
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
            secure: emailConfig.secure
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
                public_cible TEXT DEFAULT 'adulte',
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
                public_cible VARCHAR(50) DEFAULT 'adulte',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        );
        console.log('🔧 Création table users...');
        await db.run(usersSQL);
        console.log('✅ Table users créée');

        // Table des sports (natation, vélo, course à pied, PPG/musculation...)
        // Créée avant creneaux : celle-ci y fait référence via sport_id.
        const sportsSQL = db.adaptSQL(
            // SQLite
            `CREATE TABLE IF NOT EXISTS sports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                slug TEXT UNIQUE NOT NULL,
                nom TEXT NOT NULL,
                icone TEXT DEFAULT '',
                couleur TEXT DEFAULT '#28A0E8',
                capacite_defaut INTEGER,
                ordre INTEGER NOT NULL DEFAULT 0,
                actif BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            // PostgreSQL
            `CREATE TABLE IF NOT EXISTS sports (
                id SERIAL PRIMARY KEY,
                slug VARCHAR(50) UNIQUE NOT NULL,
                nom VARCHAR(100) NOT NULL,
                icone VARCHAR(10) DEFAULT '',
                couleur VARCHAR(20) DEFAULT '#28A0E8',
                capacite_defaut INTEGER,
                ordre INTEGER NOT NULL DEFAULT 0,
                actif BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        );
        console.log('🔧 Création table sports...');
        await db.run(sportsSQL);
        console.log('✅ Table sports créée');

        // Migration de capacite_defaut ici, et non dans le bloc de migration plus bas :
        // CREATE TABLE IF NOT EXISTS n'ajoute rien à une table existante, or l'insertion
        // des sports par défaut juste en dessous référence déjà cette colonne.
        try {
            let sportsAColonneCapacite;
            if (db.isPostgres) {
                sportsAColonneCapacite = !!(await db.get(`
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name='sports' AND column_name='capacite_defaut'
                `));
            } else {
                const colsSports = await db.query(`PRAGMA table_info(sports)`);
                sportsAColonneCapacite = colsSports.some(c => c.name === 'capacite_defaut');
            }

            if (!sportsAColonneCapacite) {
                console.log('🔄 Migration en cours : Ajout capacite_defaut dans sports...');
                await db.run(`ALTER TABLE sports ADD COLUMN capacite_defaut INTEGER`);
                console.log('✅ Migration de capacite_defaut (sports) terminée.');
            }
        } catch (err) {
            console.error('❌ Erreur migration capacite_defaut:', err.message);
        }

        // Sports par défaut. La natation reste le sport historique : tous les
        // créneaux existants lui sont rattachés par la migration plus bas.
        // capacite_defaut : capacité proposée quand l'admin n'en saisit pas.
        // La natation n'en a pas : sa capacité vient des lignes d'eau.
        const sportsParDefaut = [
            ['natation', 'Natation', '🏊', '#28A0E8', null, 1],
            ['velo', 'Vélo', '🚴', '#F59E0B', 50, 2],
            ['course', 'Course à pied', '🏃', '#10B981', 50, 3],
            ['ppg', 'PPG / Musculation', '💪', '#8B5CF6', 20, 4]
        ];
        const insertSportSQL = db.adaptSQL(
            `INSERT OR IGNORE INTO sports (slug, nom, icone, couleur, capacite_defaut, ordre) VALUES (?, ?, ?, ?, ?, ?)`,
            `INSERT INTO sports (slug, nom, icone, couleur, capacite_defaut, ordre) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (slug) DO NOTHING`
        );
        for (const sport of sportsParDefaut) {
            await db.run(insertSportSQL, sport);
        }
        console.log('✅ Sports par défaut initialisés');

        // Table des créneaux
        const creneauxSQL = db.adaptSQL(
            // SQLite
            `CREATE TABLE IF NOT EXISTS creneaux (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nom TEXT NOT NULL,
                sport_id INTEGER,
                jour_semaine INTEGER NOT NULL,
                heure_debut TEXT NOT NULL,
                heure_fin TEXT NOT NULL,
                capacite_max INTEGER NOT NULL DEFAULT 12,
                sans_limite BOOLEAN DEFAULT 0,
                lieu TEXT,
                nombre_lignes INTEGER,
                personnes_par_ligne INTEGER,
                licences_autorisees TEXT DEFAULT 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles',
                public_cible TEXT DEFAULT 'les deux',
                actif BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sport_id) REFERENCES sports (id)
            )`,
            // PostgreSQL
            `CREATE TABLE IF NOT EXISTS creneaux (
                id SERIAL PRIMARY KEY,
                nom VARCHAR(255) NOT NULL,
                sport_id INTEGER REFERENCES sports (id),
                jour_semaine INTEGER NOT NULL,
                heure_debut VARCHAR(10) NOT NULL,
                heure_fin VARCHAR(10) NOT NULL,
                capacite_max INTEGER NOT NULL DEFAULT 12,
                sans_limite BOOLEAN DEFAULT false,
                lieu VARCHAR(255),
                nombre_lignes INTEGER,
                personnes_par_ligne INTEGER,
                licences_autorisees TEXT DEFAULT 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles',
                public_cible VARCHAR(50) DEFAULT 'les deux',
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
                date_seance TEXT NOT NULL,
                statut TEXT DEFAULT 'inscrit',
                position_attente INTEGER NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (creneau_id) REFERENCES creneaux (id),
                UNIQUE(user_id, creneau_id, date_seance)
            )`,
            // PostgreSQL
            `CREATE TABLE IF NOT EXISTS inscriptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL,
                creneau_id INTEGER NOT NULL,
                date_seance DATE NOT NULL,
                statut VARCHAR(50) DEFAULT 'inscrit',
                position_attente INTEGER NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (creneau_id) REFERENCES creneaux (id),
                UNIQUE(user_id, creneau_id, date_seance)
            )`
        );
        console.log('🔧 Création table inscriptions...');
        await db.run(inscriptionsSQL);
        console.log('✅ Table inscriptions créée');

        // ==== MIGRATION AUTOMATIQUE ====
        try {
            if (db.isPostgres) {
                // Inscriptions : date_seance
                const checkColInscr = await db.get(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name='inscriptions' AND column_name='date_seance'
                `);
                if (!checkColInscr) {
                    console.log('🔄 Migration PostgreSQL en cours : Ajout date_seance...');
                    await db.pool.query(`ALTER TABLE inscriptions ADD COLUMN date_seance DATE;`);
                    await db.pool.query(`UPDATE inscriptions SET date_seance = CURRENT_DATE WHERE date_seance IS NULL;`);
                    await db.pool.query(`ALTER TABLE inscriptions ALTER COLUMN date_seance SET NOT NULL;`);
                    await db.pool.query(`ALTER TABLE inscriptions DROP CONSTRAINT IF EXISTS inscriptions_user_id_creneau_id_key;`);
                    await db.pool.query(`ALTER TABLE inscriptions ADD CONSTRAINT inscriptions_user_id_creneau_id_date_seance_key UNIQUE (user_id, creneau_id, date_seance);`);
                    console.log('✅ Migration PostgreSQL de date_seance terminée.');
                }

                // Users : public_cible
                const checkColUsers = await db.get(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name='users' AND column_name='public_cible'
                `);
                if (!checkColUsers) {
                    console.log('🔄 Migration PostgreSQL en cours : Ajout public_cible dans users...');
                    await db.pool.query(`ALTER TABLE users ADD COLUMN public_cible VARCHAR(50) DEFAULT 'adulte';`);
                    console.log('✅ Migration PostgreSQL de public_cible (users) terminée.');
                }

                // Creneaux : public_cible
                const checkColCreneaux = await db.get(`
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name='creneaux' AND column_name='public_cible'
                `);
                if (!checkColCreneaux) {
                    console.log('🔄 Migration PostgreSQL en cours : Ajout public_cible dans creneaux...');
                    await db.pool.query(`ALTER TABLE creneaux ADD COLUMN public_cible VARCHAR(50) DEFAULT 'les deux';`);
                    console.log('✅ Migration PostgreSQL de public_cible (creneaux) terminée.');
                }

                // Creneaux : sport_id (multi-sports)
                const checkColSport = await db.get(`
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name='creneaux' AND column_name='sport_id'
                `);
                if (!checkColSport) {
                    console.log('🔄 Migration PostgreSQL en cours : Ajout sport_id dans creneaux...');
                    await db.pool.query(`ALTER TABLE creneaux ADD COLUMN sport_id INTEGER REFERENCES sports (id);`);
                    console.log('✅ Migration PostgreSQL de sport_id (creneaux) terminée.');
                }

                // Creneaux : capacite_max devient la source de vérité de la capacité
                const checkColCapacite = await db.get(`
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name='creneaux' AND column_name='capacite_max'
                `);
                if (!checkColCapacite) {
                    console.log('🔄 Migration PostgreSQL en cours : Ajout capacite_max dans creneaux...');
                    await db.pool.query(`ALTER TABLE creneaux ADD COLUMN capacite_max INTEGER;`);
                    console.log('✅ Migration PostgreSQL de capacite_max (creneaux) terminée.');
                }

                // Les lignes d'eau ne concernent que la natation : elles deviennent facultatives
                await db.pool.query(`ALTER TABLE creneaux ALTER COLUMN nombre_lignes DROP NOT NULL;`);
                await db.pool.query(`ALTER TABLE creneaux ALTER COLUMN personnes_par_ligne DROP NOT NULL;`);

                // Creneaux : créneaux sans limite de places (sorties extérieures)
                const checkColSansLimite = await db.get(`
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name='creneaux' AND column_name='sans_limite'
                `);
                if (!checkColSansLimite) {
                    console.log('🔄 Migration PostgreSQL en cours : Ajout sans_limite dans creneaux...');
                    await db.pool.query(`ALTER TABLE creneaux ADD COLUMN sans_limite BOOLEAN DEFAULT false;`);
                    console.log('✅ Migration PostgreSQL de sans_limite (creneaux) terminée.');
                }

                // Creneaux : lieu de la séance (piscine, gymnase, point de départ...)
                const checkColLieu = await db.get(`
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name='creneaux' AND column_name='lieu'
                `);
                if (!checkColLieu) {
                    console.log('🔄 Migration PostgreSQL en cours : Ajout lieu dans creneaux...');
                    await db.pool.query(`ALTER TABLE creneaux ADD COLUMN lieu VARCHAR(255);`);
                    console.log('✅ Migration PostgreSQL de lieu (creneaux) terminée.');
                }

            } else {
                // SQLite check inscriptions
                const colsInscr = await db.query(`PRAGMA table_info(inscriptions)`);
                const hasDateSeance = colsInscr.some(c => c.name === 'date_seance');
                if (!hasDateSeance) {
                    console.log('🔄 Migration SQLite : Vous devez recréer la table inscriptions ou exécuter ALTER TABLE manuellement pour date_seance.');
                }

                // SQLite check users
                const colsUsers = await db.query(`PRAGMA table_info(users)`);
                const hasPublicUsers = colsUsers.some(c => c.name === 'public_cible');
                if (!hasPublicUsers) {
                    console.log('🔄 Migration SQLite en cours : Ajout public_cible dans users...');
                    await db.run(`ALTER TABLE users ADD COLUMN public_cible TEXT DEFAULT 'adulte'`);
                    console.log('✅ Migration SQLite public_cible terminée pour users.');
                }

                // SQLite check creneaux
                const colsCreneaux = await db.query(`PRAGMA table_info(creneaux)`);
                const hasPublicCreneaux = colsCreneaux.some(c => c.name === 'public_cible');
                if (!hasPublicCreneaux) {
                    console.log('🔄 Migration SQLite en cours : Ajout public_cible dans creneaux...');
                    await db.run(`ALTER TABLE creneaux ADD COLUMN public_cible TEXT DEFAULT 'les deux'`);
                    console.log('✅ Migration SQLite public_cible terminée pour creneaux.');
                }

                // SQLite : sport_id (multi-sports)
                const hasSportId = colsCreneaux.some(c => c.name === 'sport_id');
                if (!hasSportId) {
                    console.log('🔄 Migration SQLite en cours : Ajout sport_id dans creneaux...');
                    await db.run(`ALTER TABLE creneaux ADD COLUMN sport_id INTEGER REFERENCES sports (id)`);
                    console.log('✅ Migration SQLite sport_id terminée pour creneaux.');
                }

                // SQLite : capacite_max devient la source de vérité de la capacité
                const hasCapacite = colsCreneaux.some(c => c.name === 'capacite_max');
                if (!hasCapacite) {
                    console.log('🔄 Migration SQLite en cours : Ajout capacite_max dans creneaux...');
                    await db.run(`ALTER TABLE creneaux ADD COLUMN capacite_max INTEGER`);
                    console.log('✅ Migration SQLite capacite_max terminée pour creneaux.');
                }

                // SQLite : créneaux sans limite de places (sorties extérieures)
                if (!colsCreneaux.some(c => c.name === 'sans_limite')) {
                    console.log('🔄 Migration SQLite en cours : Ajout sans_limite dans creneaux...');
                    await db.run(`ALTER TABLE creneaux ADD COLUMN sans_limite BOOLEAN DEFAULT 0`);
                    console.log('✅ Migration SQLite sans_limite terminée pour creneaux.');
                }

                // SQLite : lieu de la séance
                if (!colsCreneaux.some(c => c.name === 'lieu')) {
                    console.log('🔄 Migration SQLite en cours : Ajout lieu dans creneaux...');
                    await db.run(`ALTER TABLE creneaux ADD COLUMN lieu TEXT`);
                    console.log('✅ Migration SQLite lieu terminée pour creneaux.');
                }

                // SQLite ne sait pas retirer un NOT NULL : reconstruction de la table pour
                // rendre les lignes d'eau facultatives (elles ne concernent que la natation).
                const colLignes = colsCreneaux.find(c => c.name === 'nombre_lignes');
                if (colLignes && colLignes.notnull === 1) {
                    console.log('🔄 Migration SQLite en cours : lignes d\'eau rendues facultatives...');
                    await db.run(`UPDATE creneaux SET capacite_max = nombre_lignes * personnes_par_ligne WHERE capacite_max IS NULL`);
                    await db.run(`ALTER TABLE creneaux RENAME TO creneaux_old`);
                    await db.run(creneauxSQL);
                    await db.run(`
                        INSERT INTO creneaux (id, nom, sport_id, jour_semaine, heure_debut, heure_fin,
                                              capacite_max, sans_limite, lieu, nombre_lignes, personnes_par_ligne,
                                              licences_autorisees, public_cible, actif, created_at)
                        SELECT id, nom, sport_id, jour_semaine, heure_debut, heure_fin,
                               capacite_max, sans_limite, lieu, nombre_lignes, personnes_par_ligne,
                               licences_autorisees, public_cible, actif, created_at
                        FROM creneaux_old
                    `);
                    await db.run(`DROP TABLE creneaux_old`);
                    console.log('✅ Migration SQLite des lignes d\'eau terminée.');
                }

            }

            // Renseigner la capacité par défaut des sports déjà créés (la table
            // existait avant l'ajout de la colonne, l'insertion initiale les ignore).
            for (const [slug, capacite] of [['velo', 50], ['course', 50], ['ppg', 20]]) {
                await db.run(
                    db.adaptSQL(
                        `UPDATE sports SET capacite_defaut = ? WHERE slug = ? AND capacite_defaut IS NULL`,
                        `UPDATE sports SET capacite_defaut = $1 WHERE slug = $2 AND capacite_defaut IS NULL`
                    ),
                    [capacite, slug]
                );
            }

            // Reprise des capacités historiques : lignes d'eau × personnes par ligne
            const backfillCapacite = await db.run(
                `UPDATE creneaux SET capacite_max = nombre_lignes * personnes_par_ligne
                 WHERE capacite_max IS NULL AND nombre_lignes IS NOT NULL AND personnes_par_ligne IS NOT NULL`
            );
            if (backfillCapacite.changes > 0) {
                console.log(`🔄 Capacité calculée pour ${backfillCapacite.changes} créneau(x) existant(s)`);
            }

            // Rattachement des créneaux sans sport à la natation (sport historique).
            // Vaut pour les bases existantes comme pour toute ligne créée avant la phase multi-sports.
            const natation = await db.get(
                db.adaptSQL(`SELECT id FROM sports WHERE slug = ?`, `SELECT id FROM sports WHERE slug = $1`),
                ['natation']
            );
            if (natation) {
                const backfill = await db.run(
                    db.adaptSQL(
                        `UPDATE creneaux SET sport_id = ? WHERE sport_id IS NULL`,
                        `UPDATE creneaux SET sport_id = $1 WHERE sport_id IS NULL`
                    ),
                    [natation.id]
                );
                if (backfill.changes > 0) {
                    console.log(`🔄 ${backfill.changes} créneau(x) rattaché(s) à la natation`);
                }
            }
        } catch (migrationErr) {
            console.error('❌ Erreur critique lors de la vérification/migration:', migrationErr);
        }
        // ======================================================

        // Table des limites de séances, par type de licence ET par sport.
        // Un sport sans ligne ici n'impose aucune limite : seule la natation
        // est contrainte par son infrastructure (lignes d'eau).
        const limitsSQL = db.adaptSQL(
            // SQLite
            `CREATE TABLE IF NOT EXISTS licence_limits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                licence_type TEXT NOT NULL,
                sport_id INTEGER,
                max_seances_semaine INTEGER NOT NULL DEFAULT 3,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(licence_type, sport_id),
                FOREIGN KEY (sport_id) REFERENCES sports (id)
            )`,
            // PostgreSQL
            `CREATE TABLE IF NOT EXISTS licence_limits (
                id SERIAL PRIMARY KEY,
                licence_type VARCHAR(100) NOT NULL,
                sport_id INTEGER REFERENCES sports (id),
                max_seances_semaine INTEGER NOT NULL DEFAULT 3,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(licence_type, sport_id)
            )`
        );
        console.log('🔧 Création table licence_limits...');
        await db.run(limitsSQL);
        console.log('✅ Table licence_limits créée');

        // Migration : rattacher les limites existantes à la natation.
        // Comme pour les sports, elle doit précéder l'insertion des valeurs
        // par défaut plus bas, qui référencent déjà sport_id.
        try {
            let limitsOntSportId;
            if (db.isPostgres) {
                limitsOntSportId = !!(await db.get(`
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name='licence_limits' AND column_name='sport_id'
                `));
            } else {
                const colsLimits = await db.query(`PRAGMA table_info(licence_limits)`);
                limitsOntSportId = colsLimits.some(c => c.name === 'sport_id');
            }

            if (!limitsOntSportId) {
                console.log('🔄 Migration en cours : Ajout sport_id dans licence_limits...');
                const natation = await db.get(
                    db.adaptSQL(`SELECT id FROM sports WHERE slug = ?`, `SELECT id FROM sports WHERE slug = $1`),
                    ['natation']
                );

                if (db.isPostgres) {
                    await db.pool.query(`ALTER TABLE licence_limits ADD COLUMN sport_id INTEGER REFERENCES sports (id);`);
                    await db.pool.query(`UPDATE licence_limits SET sport_id = $1 WHERE sport_id IS NULL;`, [natation ? natation.id : null]);
                    // L'unicité porte désormais sur le couple licence + sport
                    await db.pool.query(`ALTER TABLE licence_limits DROP CONSTRAINT IF EXISTS licence_limits_licence_type_key;`);
                    await db.pool.query(`ALTER TABLE licence_limits DROP CONSTRAINT IF EXISTS licence_limits_licence_type_sport_id_key;`);
                    await db.pool.query(`ALTER TABLE licence_limits ADD CONSTRAINT licence_limits_licence_type_sport_id_key UNIQUE (licence_type, sport_id);`);
                } else {
                    // SQLite ne sait pas modifier une contrainte : reconstruction
                    await db.run(`ALTER TABLE licence_limits RENAME TO licence_limits_old`);
                    await db.run(limitsSQL);
                    await db.run(
                        `INSERT INTO licence_limits (id, licence_type, sport_id, max_seances_semaine, created_at)
                         SELECT id, licence_type, ?, max_seances_semaine, created_at FROM licence_limits_old`,
                        [natation ? natation.id : null]
                    );
                    await db.run(`DROP TABLE licence_limits_old`);
                }
                console.log('✅ Migration de sport_id (licence_limits) terminée.');
            }
        } catch (err) {
            console.error('❌ Erreur migration sport_id (licence_limits):', err.message);
        }

        // Table des blocs hebdomadaires
        const blocsSQL = db.adaptSQL(
            // SQLite
            `CREATE TABLE IF NOT EXISTS blocs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nom TEXT NOT NULL,
                description TEXT,
                sport_id INTEGER,
                ordre INTEGER NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sport_id) REFERENCES sports (id)
            )`,
            // PostgreSQL
            `CREATE TABLE IF NOT EXISTS blocs (
                id SERIAL PRIMARY KEY,
                nom VARCHAR(255) NOT NULL,
                description TEXT,
                sport_id INTEGER REFERENCES sports (id),
                ordre INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        );
        console.log('🔧 Création table blocs...');
        await db.run(blocsSQL);
        console.log('✅ Table blocs créée');

        // Migration : les blocs existants relèvent de la natation
        try {
            let blocsOntSportId;
            if (db.isPostgres) {
                blocsOntSportId = !!(await db.get(`
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name='blocs' AND column_name='sport_id'
                `));
            } else {
                const colsBlocs = await db.query(`PRAGMA table_info(blocs)`);
                blocsOntSportId = colsBlocs.some(c => c.name === 'sport_id');
            }

            if (!blocsOntSportId) {
                console.log('🔄 Migration en cours : Ajout sport_id dans blocs...');
                await db.run(`ALTER TABLE blocs ADD COLUMN sport_id INTEGER REFERENCES sports (id)`);
                console.log('✅ Migration de sport_id (blocs) terminée.');
            }

            const natationBlocs = await db.get(
                db.adaptSQL(`SELECT id FROM sports WHERE slug = ?`, `SELECT id FROM sports WHERE slug = $1`),
                ['natation']
            );
            if (natationBlocs) {
                const rattaches = await db.run(
                    db.adaptSQL(
                        `UPDATE blocs SET sport_id = ? WHERE sport_id IS NULL`,
                        `UPDATE blocs SET sport_id = $1 WHERE sport_id IS NULL`
                    ),
                    [natationBlocs.id]
                );
                if (rattaches.changes > 0) {
                    console.log(`🔄 ${rattaches.changes} bloc(s) rattaché(s) à la natation`);
                }
            }
        } catch (err) {
            console.error('❌ Erreur migration sport_id (blocs):', err.message);
        }

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

        // Table des tokens de réinitialisation de mot de passe
        const passwordResetTokensSQL = db.adaptSQL(
            // SQLite
            `CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT UNIQUE NOT NULL,
                user_id INTEGER NOT NULL,
                expires_at DATETIME NOT NULL,
                used BOOLEAN DEFAULT FALSE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )`,
            // PostgreSQL
            `CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id SERIAL PRIMARY KEY,
                token VARCHAR(255) UNIQUE NOT NULL,
                user_id INTEGER NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                used BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )`
        );
        console.log('🔧 Création table password_reset_tokens...');
        await db.run(passwordResetTokensSQL);
        console.log('✅ Table password_reset_tokens créée');

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
                sport_id INTEGER,
                jour_source INTEGER NOT NULL,
                jours_interdits TEXT NOT NULL,
                description TEXT,
                active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sport_id) REFERENCES sports (id)
            )`,
            // PostgreSQL
            `CREATE TABLE IF NOT EXISTS meta_rules (
                id SERIAL PRIMARY KEY,
                licence_type VARCHAR(100) NOT NULL,
                sport_id INTEGER REFERENCES sports (id),
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

        // Migration : les méta-règles existantes visent la natation, sans quoi
        // elles interdiraient aussi les créneaux des autres sports le même jour.
        try {
            let metaOntSportId;
            if (db.isPostgres) {
                metaOntSportId = !!(await db.get(`
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name='meta_rules' AND column_name='sport_id'
                `));
            } else {
                const colsMeta = await db.query(`PRAGMA table_info(meta_rules)`);
                metaOntSportId = colsMeta.some(c => c.name === 'sport_id');
            }

            if (!metaOntSportId) {
                console.log('🔄 Migration en cours : Ajout sport_id dans meta_rules...');
                await db.run(`ALTER TABLE meta_rules ADD COLUMN sport_id INTEGER REFERENCES sports (id)`);
                console.log('✅ Migration de sport_id (meta_rules) terminée.');
            }

            const natationMeta = await db.get(
                db.adaptSQL(`SELECT id FROM sports WHERE slug = ?`, `SELECT id FROM sports WHERE slug = $1`),
                ['natation']
            );
            if (natationMeta) {
                const rattachees = await db.run(
                    db.adaptSQL(
                        `UPDATE meta_rules SET sport_id = ? WHERE sport_id IS NULL`,
                        `UPDATE meta_rules SET sport_id = $1 WHERE sport_id IS NULL`
                    ),
                    [natationMeta.id]
                );
                if (rattachees.changes > 0) {
                    console.log(`🔄 ${rattachees.changes} méta-règle(s) rattachée(s) à la natation`);
                }
            }
        } catch (err) {
            console.error('❌ Erreur migration sport_id (meta_rules):', err.message);
        }

        // Séances datées : table, colonnes de rattachement et reprise de l'existant
        await seances.migrer(db);

        // Créer admin par défaut
        // En production, ADMIN_PASSWORD doit être définie : pas de mot de passe par défaut
        if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_PASSWORD) {
            console.log('⚠️ ADMIN_PASSWORD non définie : création du compte admin par défaut ignorée');
        } else {
            const adminEmail = process.env.ADMIN_EMAIL || 'admin@triathlon.com';
            const adminPassword = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);

            const insertAdminSQL = db.adaptSQL(
                `INSERT OR IGNORE INTO users (email, password, nom, prenom, role) VALUES (?, ?, 'Admin', 'Système', 'admin')`,
                `INSERT INTO users (email, password, nom, prenom, role) VALUES (?, ?, 'Admin', 'Système', 'admin') ON CONFLICT (email) DO NOTHING`
            );
            await db.run(insertAdminSQL, [adminEmail, adminPassword]);
        }

        // Utilisateur pour les tests E2E Playwright (base SQLite en mémoire, mode test uniquement)
        if (process.env.NODE_ENV === 'test') {
            const e2ePassword = bcrypt.hashSync('correctpassword', 10);
            const insertE2eSQL = db.adaptSQL(
                `INSERT OR IGNORE INTO users (email, password, nom, prenom, role) VALUES (?, ?, 'Playwright', 'Test', 'admin')`,
                `INSERT INTO users (email, password, nom, prenom, role) VALUES (?, ?, 'Playwright', 'Test', 'admin') ON CONFLICT (email) DO NOTHING`
            );
            await db.run(insertE2eSQL, ['test@playwright.com', e2ePassword]);
        }

        // Créer utilisateur de test (seulement en développement)
        if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
            const userPassword = bcrypt.hashSync('test123', 10);
            const insertUserSQL = db.adaptSQL(
                `INSERT OR IGNORE INTO users (email, password, nom, prenom, licence_type, public_cible) VALUES (?, ?, 'Dupont', 'Jean', 'Loisir/Senior', 'adulte')`,
                `INSERT INTO users (email, password, nom, prenom, licence_type, public_cible) VALUES (?, ?, 'Dupont', 'Jean', 'Loisir/Senior', 'adulte') ON CONFLICT (email) DO NOTHING`
            );
            await db.run(insertUserSQL, ['test@triathlon.com', userPassword]);

            // Ajouter un jeune pour tester
            const enfantPassword = bcrypt.hashSync('enfant123', 10);
            const insertEnfantSQL = db.adaptSQL(
                `INSERT OR IGNORE INTO users (email, password, nom, prenom, licence_type, public_cible) VALUES (?, ?, 'Martin', 'Leo', 'Benjamins/Junior', 'jeune')`,
                `INSERT INTO users (email, password, nom, prenom, licence_type, public_cible) VALUES (?, ?, 'Martin', 'Leo', 'Benjamins/Junior', 'jeune') ON CONFLICT (email) DO NOTHING`
            );
            await db.run(insertEnfantSQL, ['testenfant@triathlon.com', enfantPassword]);
        }

        // Créer créneaux de test
        const creneauxCount = await db.get(`SELECT COUNT(*) as count FROM creneaux`);
        if (!creneauxCount || creneauxCount.count === 0) {
            console.log('Création des créneaux de test...');
            // Créneaux de référence (Lundi=1, Mardi=2, Mercredi=3, Jeudi=4, Vendredi=5, Samedi=6)
            const creneauxTest = [
                // Bloc début de semaine
                ['Lundi Matin 7h-8h', 1, '07:00', '08:00', 2, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles', 'les deux'],
                ['Lundi 11h15-12h30', 1, '11:15', '12:30', 2, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles', 'adulte'],
                ['Lundi 12h30-13h30', 1, '12:30', '13:30', 2, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles', 'adulte'],
                ['Mardi Matin 7h-8h30', 2, '07:00', '08:30', 2, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles', 'jeune'],
                // Bloc milieu de semaine
                ['Mercredi Matin 7h-8h', 3, '07:00', '08:00', 1, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles', 'les deux'],
                ['Jeudi Matin 7h-8h', 4, '07:00', '08:00', 1, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles', 'adulte'],
                ['Jeudi Soir 20h30-21h30', 4, '20:30', '21:30', 3, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles', 'les deux'],
                ['Vendredi Midi 12h-13h30', 5, '12:00', '13:30', 2, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles', 'les deux'],
                // Bloc fin de semaine
                ['Samedi Matin 8h-9h', 6, '08:00', '09:00', 4, 6, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles', 'les deux'],
            ];

            const sportNatation = await db.get(
                db.adaptSQL(`SELECT id FROM sports WHERE slug = ?`, `SELECT id FROM sports WHERE slug = $1`),
                ['natation']
            );

            for (const [nom, jour, debut, fin, lignes, personnes, licences, cible] of creneauxTest) {
                await db.run(`INSERT INTO creneaux (nom, sport_id, jour_semaine, heure_debut, heure_fin, nombre_lignes, personnes_par_ligne, licences_autorisees, public_cible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [nom, sportNatation ? sportNatation.id : null, jour, debut, fin, lignes, personnes, licences, cible]);
            }
        }

        // Créer limites par défaut
        const limitsCount = await db.get(`SELECT COUNT(*) as count FROM licence_limits`);
        if (!limitsCount || limitsCount.count === 0) {
            // Les quotas ne concernent que la natation : les autres sports
            // restent sans limite tant qu'aucune ligne n'est créée pour eux.
            const natationLimites = await db.get(
                db.adaptSQL(`SELECT id FROM sports WHERE slug = ?`, `SELECT id FROM sports WHERE slug = $1`),
                ['natation']
            );

            const limitesParDefaut = [
                ['Compétition', 6],
                ['Loisir/Senior', 3],
                ['Benjamins/Junior', 4],
                ['Poussins/Pupilles', 2]
            ];

            for (const [licenceType, maxSeances] of limitesParDefaut) {
                await db.run(`INSERT INTO licence_limits (licence_type, sport_id, max_seances_semaine) VALUES (?, ?, ?)`,
                    [licenceType, natationLimites ? natationLimites.id : null, maxSeances]);
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

        // Semaines types : après les créneaux d'exemple, qu'elles rattachent
        await semainesTypes.migrer(db);

        console.log('✅ Base de données initialisée avec succès');
    } catch (err) {
        console.error('❌ Erreur initialisation base de données:', err);
        throw err;
    }
}

// Initialisation de la base de données
console.log('🔄 Initialisation de la base de données...');
console.log('🔍 DATABASE_URL présente:', !!process.env.DATABASE_URL);
console.log('🔍 Type détecté:', db.isPostgres ? 'PostgreSQL' : 'SQLite');

// Initialisation unifiée pour PostgreSQL et SQLite
const dbPrete = initializeDatabase().then(() => {
    console.log(`✅ Base de données ${db.isPostgres ? 'PostgreSQL' : 'SQLite'} initialisée avec succès`);
}).catch(err => {
    console.error('❌ ERREUR CRITIQUE initialisation base de données:', err);
    console.error('❌ Stack trace:', err.stack);
});

// Fonction pour générer un token sécurisé (liste d'attente, réinitialisation de mot de passe)
const crypto = require('crypto');
const generateSecureToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

// L'email sert d'identifiant : il se compare toujours en minuscules, des deux
// côtés. Les comptes créés avant cette règle peuvent contenir des majuscules,
// d'où le LOWER(email) dans les requêtes plutôt qu'une simple égalité.
const normaliserEmail = (email) => String(email ?? '').trim().toLowerCase();

// Promotion automatique de la liste d'attente après un gain de places
// (capacité augmentée, ou créneau passé sans limite), séance par séance.
// Contrairement à la libération d'une place unique — qui notifie tout le monde
// et récompense le premier à confirmer — les places sont ici disponibles
// immédiatement : on promeut donc directement, dans l'ordre d'attente.
const promouvoirSeances = async (seanceIds) => {
    const promus = [];
    for (const seanceId of seanceIds) {
        const resultat = await seances.promouvoirSeance(db, seanceId);
        for (const userId of resultat.promus) {
            promus.push({ userId, seance: resultat.seance });
        }
    }
    if (promus.length > 0) {
        console.log(`✅ ${promus.length} inscription(s) promue(s) depuis la liste d'attente`);
    }
    return promus;
};

// « jeudi 17 septembre »
const dateLisible = (dateSeance) => new Date(`${dateSeance}T12:00:00Z`).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris'
});

// Prévenir un membre que sa place d'attente est devenue une inscription ferme
const notifierPromotion = async (userId, seance) => {
    try {
        const user = await db.get(`SELECT email, nom, prenom FROM users WHERE id = ?`, [userId]);
        if (!user) return false;

        return await sendEmail(
            user.email,
            `✅ Votre place est confirmée - ${seance.nom}`,
            `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #28A0E8;">✅ Votre place est confirmée</h2>
                <p>Bonjour ${user.prenom} ${user.nom},</p>
                <p>Vous étiez en liste d'attente pour le créneau
                   <strong>${seance.nom}</strong> du ${dateLisible(seance.date_seance)}.</p>
                <p>Des places ont été ajoutées : <strong>votre inscription est désormais confirmée</strong>.
                   Vous n'avez aucune démarche à faire.</p>
                <p style="color: #6b7280; font-size: 14px;">
                    Si vous ne pouvez finalement pas venir, pensez à vous désinscrire
                    depuis l'application pour libérer votre place.
                </p>
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                    ACC Triathlon - Gestion des créneaux
                </p>
            </div>
            `
        );
    } catch (err) {
        console.error('❌ Erreur notification de promotion:', err);
        return false;
    }
};

// Une place s'est libérée : chaque personne en attente reçoit un lien, le
// premier à confirmer obtient la place.
const notifyWaitlistUser = async (userId, seance) => {
    try {
        const userInfo = await db.get(`SELECT email, nom, prenom FROM users WHERE id = ?`, [userId]);

        if (!userInfo) {
            console.error('❌ Utilisateur introuvable pour notification');
            return false;
        }

        // Générer un token unique
        const token = generateSecureToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24); // Expire dans 24h

        await db.run(
            `INSERT INTO waitlist_tokens (token, user_id, creneau_id, seance_id, date_seance, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [token, userId, seance.creneau_id, seance.id, seance.date_seance, expiresAt.toISOString()]
        );

        // Créer le lien d'inscription
        const inscriptionLink = `${getBaseUrl()}/inscription-attente?token=${token}`;
        const jour = dateLisible(seance.date_seance);

        // Template d'email
        const emailContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #2563eb;">🏊‍♀️ Une place s'est libérée !</h2>
                
                <p>Bonjour ${userInfo.prenom} ${userInfo.nom},</p>
                
                <p>Bonne nouvelle ! Une place s'est libérée pour le créneau :</p>
                
                <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <p style="margin: 0; color: #92400e; font-weight: bold;">
                        ⚡ Premier arrivé, premier servi !
                    </p>
                    <p style="margin: 5px 0 0 0; color: #92400e; font-size: 14px;">
                        Cet email a été envoyé à toutes les personnes en liste d'attente. Le premier qui confirme son inscription obtiendra la place.
                    </p>
                </div>
                
                <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin: 0; color: #1f2937;">${seance.nom}</h3>
                    <p style="margin: 10px 0 0 0; color: #6b7280;">
                        📅 ${jour.charAt(0).toUpperCase() + jour.slice(1)}<br>
                        🕐 ${seance.heure_debut} - ${seance.heure_fin}
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
                    ACC Triathlon - Gestion des créneaux
                </p>
            </div>
        `;

        const emailSent = await sendEmail(
            userInfo.email,
            `🏊‍♀️ Place disponible - ${seance.nom}`,
            emailContent
        );

        if (emailSent) {
            console.log(`✅ Email de notification envoyé à ${userInfo.email} pour la séance ${seance.nom} du ${seance.date_seance}`);
            return true;
        }
        console.error(`❌ Échec envoi email à ${userInfo.email}`);
        return false;
    } catch (err) {
        console.error('❌ Erreur notification liste d\'attente:', err);
        return false;
    }
};
// URL publique de l'application, utilisée dans les liens envoyés par email.
// RAILWAY_PUBLIC_DOMAIN / RAILWAY_STATIC_URL ne contiennent pas le protocole.
const getBaseUrl = () => {
    const raw = process.env.BASE_URL
        || process.env.RAILWAY_PUBLIC_DOMAIN
        || process.env.RAILWAY_STATIC_URL
        || `http://localhost:${process.env.PORT || 3000}`;
    const url = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
    return url.replace(/\/+$/, '');
};

// Fonctions d'envoi d'email (Resend + Brevo + SMTP)
//
// Railway bloque les ports SMTP sortants (25/465/587/2525) hors plan Pro :
// en production, seuls les fournisseurs à API HTTPS fonctionnent.
const sendEmail = async (to, subject, htmlContent) => {
    // Priorité 1 : Resend si configuré (gratuit 3000 emails/mois)
    if (process.env.RESEND_API_KEY) {
        try {
            const resend = new Resend(process.env.RESEND_API_KEY);

            const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'onboarding@resend.dev';
            console.log('📧 Envoi via Resend:', { to, subject, from });
            const { data, error } = await resend.emails.send({
                from: from,
                to: to,
                subject: subject,
                html: htmlContent,
            });

            // L'API Resend ne lève pas d'exception : elle renvoie { data, error }
            if (error) {
                console.error('❌ Erreur Resend:', { message: error.message, name: error.name, to, subject });
            } else {
                console.log('✅ Email envoyé via Resend:', { id: data?.id, to, subject });
                return true;
            }
        } catch (error) {
            console.error('❌ Erreur Resend (exception):', error.message);
            // Fallback vers SMTP si Resend échoue
        }
    }

    // Priorité 2 : Brevo (API HTTPS) — permet d'envoyer sans nom de domaine,
    // avec une simple adresse expéditrice validée dans Brevo.
    if (process.env.BREVO_API_KEY) {
        // Nettoyer la clé : les copier/coller vers les variables Railway ajoutent
        // parfois espaces, retours à la ligne ou guillemets, invisibles dans l'UI
        const brevoApiKey = process.env.BREVO_API_KEY.trim().replace(/^["']|["']$/g, '');
        const senderEmail = process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER;
        const senderName = process.env.MAIL_FROM_NAME || 'ACC Triathlon';

        if (brevoApiKey !== process.env.BREVO_API_KEY) {
            console.warn('⚠️  BREVO_API_KEY contenait des espaces ou guillemets parasites (nettoyés automatiquement)');
        }
        if (!brevoApiKey.startsWith('xkeysib-')) {
            console.warn(`⚠️  BREVO_API_KEY ne commence pas par "xkeysib-" (préfixe reçu: "${brevoApiKey.slice(0, 9)}…") : est-ce une clé SMTP (xsmtpsib-) au lieu d'une clé API ?`);
        }

        if (!senderEmail) {
            console.error('❌ Brevo : définissez MAIL_FROM_EMAIL avec l\'adresse expéditrice validée dans Brevo');
        } else {
            try {
                // Empreinte non sensible de la clé pour diagnostiquer les écarts de copier/coller
                console.log('📧 Envoi via Brevo:', { to, subject, from: senderEmail, keyPrefix: brevoApiKey.slice(0, 12) + '…', keyLength: brevoApiKey.length });
                const response = await fetch('https://api.brevo.com/v3/smtp/email', {
                    method: 'POST',
                    headers: {
                        'api-key': brevoApiKey,
                        'content-type': 'application/json',
                        'accept': 'application/json'
                    },
                    body: JSON.stringify({
                        sender: { name: senderName, email: senderEmail },
                        to: [{ email: to }],
                        subject: subject,
                        htmlContent: htmlContent
                    })
                });

                if (response.ok) {
                    const data = await response.json().catch(() => ({}));
                    console.log('✅ Email envoyé via Brevo:', { messageId: data.messageId, to, subject });
                    return true;
                }

                // Brevo renvoie un statut HTTP d'erreur avec { code, message }
                const details = await response.text().catch(() => '');
                console.error('❌ Erreur Brevo:', { status: response.status, details, to, subject });
            } catch (error) {
                console.error('❌ Erreur Brevo (exception):', error.message);
            }
        }
    }

    // Priorité 3 : SMTP si transporteur configuré (développement local)
    if (!transporter) {
        console.log('📧 Email non envoyé (aucun transporteur configuré):', subject);
        return false;
    }

    try {
        // Gmail (et la plupart des SMTP) imposent que l'adresse d'expédition soit
        // celle du compte authentifié : seul le nom affiché est libre.
        const fromName = process.env.MAIL_FROM_NAME || 'ACC Triathlon';
        const fromAddress = process.env.SMTP_USER || 'noreply@triathlon.com';
        const from = `"${fromName}" <${fromAddress}>`;

        if (process.env.MAIL_FROM && !process.env.MAIL_FROM.includes(fromAddress)) {
            console.warn(`⚠️  MAIL_FROM ("${process.env.MAIL_FROM}") est ignoré en SMTP : l'expéditeur reste ${fromAddress}.`);
            console.warn('⚠️  Utilisez MAIL_FROM_NAME pour changer le nom affiché.');
        }

        console.log('📧 Tentative d\'envoi email via SMTP:', { to, subject, from });

        const info = await transporter.sendMail({
            from: from,
            to: to,
            subject: subject,
            html: htmlContent
        });

        if (isEtherealTransport) {
            console.warn('⚠️  Email NON délivré : envoyé vers la boîte de test Ethereal, pas vers', to);
            console.warn('⚠️  Configurez RESEND_API_KEY ou SMTP_HOST/SMTP_USER/SMTP_PASS pour de vrais envois.');
            const preview = nodemailer.getTestMessageUrl(info);
            if (preview) console.warn('👀 Prévisualiser cet email :', preview);
        } else {
            console.log('✅ Email envoyé via SMTP:', { messageId: info.messageId, to, subject });
        }
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
    const { email, password, nom, prenom, licence_type, public_cible } = req.body;

    if (!email || !password || !nom || !prenom || !licence_type) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    const licencesValides = ['Compétition', 'Loisir/Senior', 'Benjamins/Junior', 'Poussins/Pupilles'];
    if (!licencesValides.includes(licence_type)) {
        return res.status(400).json({ error: 'Type de licence invalide' });
    }

    // Définir le public cible (par défaut adulte si non spécifié ou invalide)
    const cibleValide = ['jeune', 'adulte', 'les deux'];
    const cible = (public_cible && cibleValide.includes(public_cible)) ? public_cible : 'adulte';

    const hashedPassword = bcrypt.hashSync(password, 10);

    try {
        const sql = db.isPostgres ?
            `INSERT INTO users (email, password, nom, prenom, licence_type, public_cible) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id` :
            `INSERT INTO users (email, password, nom, prenom, licence_type, public_cible) VALUES (?, ?, ?, ?, ?, ?)`;

        const result = await db.run(sql, [normaliserEmail(email), hashedPassword, nom, prenom, licence_type, cible]);

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
            `SELECT * FROM users WHERE LOWER(email) = $1` :
            `SELECT * FROM users WHERE LOWER(email) = ?`;

        const user = await db.get(sql, [normaliserEmail(email)]);

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

// Mot de passe oublié : envoi d'un lien de réinitialisation par email
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email requis' });
    }

    // Réponse identique que l'email existe ou non (ne pas révéler les comptes)
    const genericMessage = 'Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.';

    try {
        const user = await db.get(
            db.isPostgres ?
                `SELECT id, email, nom, prenom FROM users WHERE LOWER(email) = $1` :
                `SELECT id, email, nom, prenom FROM users WHERE LOWER(email) = ?`,
            [normaliserEmail(email)]
        );

        if (!user) {
            console.log('🔑 Demande de réinitialisation pour un email inconnu');
            return res.json({ message: genericMessage });
        }

        // Invalider les anciens tokens de cet utilisateur
        await db.run(`UPDATE password_reset_tokens SET used = ? WHERE user_id = ?`, [true, user.id]);

        // Générer un nouveau token valable 1 heure
        const token = generateSecureToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1);

        await db.run(`INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)`,
            [token, user.id, expiresAt.toISOString()]);

        const resetLink = `${getBaseUrl()}/reset-password?token=${token}`;

        const emailContent = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #28A0E8;">🔑 Réinitialisation de votre mot de passe</h2>

                <p>Bonjour ${user.prenom} ${user.nom},</p>

                <p>Vous avez demandé la réinitialisation de votre mot de passe.
                Cliquez sur le bouton ci-dessous pour en choisir un nouveau :</p>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetLink}"
                       style="background: #28A0E8; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                        Réinitialiser mon mot de passe
                    </a>
                </div>

                <p style="color: #6b7280; font-size: 14px;">
                    ⚠️ Ce lien expire dans 1 heure.
                </p>

                <p style="color: #6b7280; font-size: 14px;">
                    Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email :
                    votre mot de passe restera inchangé.
                </p>

                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                    ACC Triathlon - Gestion des créneaux
                </p>
            </div>
        `;

        const emailSent = await sendEmail(user.email, '🔑 Réinitialisation de votre mot de passe', emailContent);
        if (!emailSent) {
            console.error(`❌ Échec envoi email de réinitialisation à ${user.email}`);
        }

        res.json({ message: genericMessage });
    } catch (err) {
        console.error('❌ Erreur demande de réinitialisation:', err);
        return res.status(500).json({ error: 'Erreur lors de la demande de réinitialisation' });
    }
});

// Vérifier la validité d'un token de réinitialisation (pour l'affichage de la page)
app.get('/api/reset-password/info/:token', async (req, res) => {
    try {
        const tokenInfo = await db.get(
            db.isPostgres ?
                `SELECT prt.expires_at, prt.used, u.email FROM password_reset_tokens prt
                 JOIN users u ON prt.user_id = u.id WHERE prt.token = $1` :
                `SELECT prt.expires_at, prt.used, u.email FROM password_reset_tokens prt
                 JOIN users u ON prt.user_id = u.id WHERE prt.token = ?`,
            [req.params.token]
        );

        if (!tokenInfo || tokenInfo.used || new Date(tokenInfo.expires_at) < new Date()) {
            return res.status(400).json({ valid: false, error: 'Lien invalide ou expiré' });
        }

        res.json({ valid: true });
    } catch (err) {
        console.error('❌ Erreur vérification token de réinitialisation:', err);
        return res.status(500).json({ error: 'Erreur lors de la vérification du lien' });
    }
});

// Réinitialiser le mot de passe avec un token valide
app.post('/api/reset-password', async (req, res) => {
    const { token, nouveauMotDePasse, confirmerMotDePasse } = req.body;

    if (!token || !nouveauMotDePasse || !confirmerMotDePasse) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    if (nouveauMotDePasse !== confirmerMotDePasse) {
        return res.status(400).json({ error: 'Les mots de passe ne correspondent pas' });
    }

    if (nouveauMotDePasse.length < 6) {
        return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }

    try {
        const tokenInfo = await db.get(
            db.isPostgres ?
                `SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = $1` :
                `SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = ?`,
            [token]
        );

        if (!tokenInfo || tokenInfo.used || new Date(tokenInfo.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Lien invalide ou expiré. Refaites une demande de réinitialisation.' });
        }

        const hashedPassword = bcrypt.hashSync(nouveauMotDePasse, 10);

        await db.run(
            db.isPostgres ?
                `UPDATE users SET password = $1 WHERE id = $2` :
                `UPDATE users SET password = ? WHERE id = ?`,
            [hashedPassword, tokenInfo.user_id]
        );

        // Marquer le token comme utilisé (usage unique)
        await db.run(`UPDATE password_reset_tokens SET used = ? WHERE id = ?`, [true, tokenInfo.id]);

        console.log(`🔑 Mot de passe réinitialisé pour l'utilisateur ${tokenInfo.user_id}`);
        res.json({ message: 'Mot de passe réinitialisé avec succès. Vous pouvez maintenant vous connecter.' });
    } catch (err) {
        console.error('❌ Erreur réinitialisation mot de passe:', err);
        return res.status(500).json({ error: 'Erreur lors de la réinitialisation du mot de passe' });
    }
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

// --- Utilitaires de dates ---
// Capacité d'un créneau : valeur directe, ou lignes d'eau × personnes (natation).
// Renvoie null si aucune des deux formes n'est exploitable.
function resoudreCapacite({ capacite_max, nombre_lignes, personnes_par_ligne }) {
    const directe = parseInt(capacite_max, 10);
    if (Number.isInteger(directe) && directe > 0) {
        return directe;
    }

    const lignes = parseInt(nombre_lignes, 10);
    const parLigne = parseInt(personnes_par_ligne, 10);
    if (Number.isInteger(lignes) && lignes > 0 && Number.isInteger(parLigne) && parLigne > 0) {
        return lignes * parLigne;
    }

    return null;
}

// Même résolution, avec repli sur la capacité par défaut configurée sur le sport
// (une sortie vélo ou une séance de course n'a pas de limite matérielle à saisir).
async function resoudreCapaciteAvecSport(db, sportId, champs) {
    const capacite = resoudreCapacite(champs);
    if (capacite) return capacite;

    if (!sportId) return null;

    const sport = await db.get(
        db.adaptSQL(`SELECT capacite_defaut FROM sports WHERE id = ?`, `SELECT capacite_defaut FROM sports WHERE id = $1`),
        [sportId]
    );

    const defaut = sport ? parseInt(sport.capacite_defaut, 10) : NaN;
    return Number.isInteger(defaut) && defaut > 0 ? defaut : null;
}

// Routes des créneaux
// Liste des sports actifs (ordre d'affichage)
app.get('/api/sports', async (req, res) => {
    try {
        const sports = await db.query(
            db.adaptSQL(
                `SELECT id, slug, nom, icone, couleur, capacite_defaut FROM sports WHERE actif = 1 ORDER BY ordre, nom`,
                `SELECT id, slug, nom, icone, couleur, capacite_defaut FROM sports WHERE actif = true ORDER BY ordre, nom`
            )
        );
        res.json(sports);
    } catch (err) {
        console.error('Erreur récupération des sports:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des sports' });
    }
});

// Lieux déjà utilisés, pour proposer l'existant à la saisie plutôt que
// de laisser se créer « Piscine Municipale » et « piscine municipale ».
app.get('/api/admin/lieux', requireAdmin, async (req, res) => {
    try {
        const rows = await db.query(
            `SELECT DISTINCT lieu FROM creneaux WHERE lieu IS NOT NULL AND lieu != '' ORDER BY lieu`,
            []
        );
        res.json(rows.map(r => r.lieu));
    } catch (err) {
        console.error('Erreur récupération des lieux:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des lieux' });
    }
});

// Profil de consultation : public ciblé et droits d'administration
const profilVisiteur = async (userId) => {
    if (!userId) return { publicCible: 'adulte', isAdmin: false };
    const user = await db.get(`SELECT role, public_cible FROM users WHERE id = ?`, [userId]);
    return {
        publicCible: (user && user.public_cible) || 'adulte',
        isAdmin: !!user && user.role === 'admin'
    };
};

// Semaine demandée (0 = en cours), ou null si le visiteur ne peut pas la consulter
const semaineDemandee = (valeur, isAdmin) => {
    const offset = Number(valeur || 0);
    const max = isAdmin ? seances.SEMAINES_ADMIN : seances.SEMAINES_MEMBRES;
    return Number.isInteger(offset) && offset >= 0 && offset < max ? offset : null;
};

// Séances d'une semaine, telles que le visiteur peut les réserver
app.get('/api/seances', async (req, res) => {
    const userId = req.session ? req.session.userId : null;

    try {
        const { publicCible, isAdmin } = await profilVisiteur(userId);
        const offset = semaineDemandee(req.query.semaine, isAdmin);
        if (offset === null) {
            return res.status(400).json({ error: 'Semaine non consultable' });
        }

        const debut = seances.lundiDeLaSemaine(offset);
        const fin = seances.ajouterJours(debut, 6);
        await seances.genererSemaine(db, debut);

        // Un admin voit toutes les séances, quel que soit leur public
        // Les séances annulées par le club restent visibles, barrées
        const liste = await seances.listerSeances(db, {
            debut, fin, publicCible: isAdmin ? null : publicCible, inclureAnnulees: 'admin'
        });

        // Bloc déjà utilisé cette semaine par une autre séance du membre
        const occupes = userId ? await seances.blocsOccupes(db, userId, debut, fin) : new Map();
        for (const seance of liste) {
            const occupe = seance.bloc_id ? occupes.get(String(seance.bloc_id)) : null;
            seance.inscrit_dans_bloc = occupe && occupe.seance_id !== seance.id ? occupe.nom : null;
        }

        res.json(liste);
    } catch (err) {
        console.error('Erreur récupération séances:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des séances' });
    }
});

// Créneaux (modèles des séances), avec le remplissage de leur séance de la
// semaine demandée. Sert à l'administration ; les membres passent par /api/seances.
app.get('/api/creneaux', async (req, res) => {
    const userId = req.session ? req.session.userId : null;

    try {
        const { publicCible, isAdmin } = await profilVisiteur(userId);
        const offset = semaineDemandee(req.query.semaine, isAdmin);
        if (offset === null) {
            return res.status(400).json({ error: 'Semaine non consultable' });
        }

        const debut = seances.lundiDeLaSemaine(offset);
        const fin = seances.ajouterJours(debut, 6);
        await seances.genererSemaine(db, debut);

        const filtres = [];
        const params = [debut, fin];
        if (!isAdmin && (publicCible === 'jeune' || publicCible === 'adulte')) {
            filtres.push(`AND c.public_cible IN ('${publicCible}', 'les deux')`);
        }
        // Créneaux sélectionnés par une semaine type (administration) ;
        // sans ce filtre, toute la bibliothèque
        if (req.query.semaine_type) {
            filtres.push('AND c.id IN (SELECT creneau_id FROM semaine_type_creneaux WHERE semaine_type_id = ?)');
            params.push(req.query.semaine_type);
        }

        const rows = await db.query(
            `SELECT c.*, b.id AS bloc_id, b.nom AS bloc_nom,
                    sp.slug AS sport_slug, sp.nom AS sport_nom, sp.icone AS sport_icone, sp.couleur AS sport_couleur,
                    s.id AS seance_id, s.date_seance AS date_seance,
                    (SELECT COUNT(*) FROM inscriptions i WHERE i.seance_id = s.id AND i.statut = 'inscrit') AS inscrits,
                    (SELECT COUNT(*) FROM inscriptions i WHERE i.seance_id = s.id AND i.statut = 'attente') AS en_attente
             FROM creneaux c
             LEFT JOIN sports sp ON c.sport_id = sp.id
             LEFT JOIN bloc_creneaux bc ON c.id = bc.creneau_id
             LEFT JOIN blocs b ON bc.bloc_id = b.id
             LEFT JOIN seances s ON s.creneau_id = c.id AND s.date_seance BETWEEN ? AND ?
             WHERE c.actif = true ${filtres.join(' ')}
             ORDER BY sp.ordre, CASE WHEN c.jour_semaine = 0 THEN 7 ELSE c.jour_semaine END, c.heure_debut, c.id`,
            params
        );

        // Semaines types qui utilisent chaque créneau
        const liens = await db.query(
            `SELECT l.creneau_id, t.id, t.nom FROM semaine_type_creneaux l
             JOIN semaines_types t ON t.id = l.semaine_type_id
             ORDER BY t.par_defaut DESC, t.nom`
        );

        const aujourdhui = seances.aujourdhuiIso();
        res.json(rows.map(row => {
            const date = row.date_seance ? seances.normaliserDate(row.date_seance) : null;
            return {
                ...row,
                semaines_types: liens.filter(l => l.creneau_id === row.id).map(({ id, nom }) => ({ id, nom })),
                date_seance: date,
                est_passe: !!date && date < aujourdhui,
                inscrits: parseInt(row.inscrits, 10) || 0,
                en_attente: parseInt(row.en_attente, 10) || 0
            };
        }));
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
            `SELECT * FROM creneaux WHERE id = ? `;

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

// --- SEMAINES TYPES ET PLANNING (ADMIN) ---

// Prévenir un membre que sa séance est annulée (changement de semaine type)
const notifierAnnulation = async (inscrit, seance, contexte = 'Le planning de la semaine a changé') => {
    const jour = dateLisible(seance.date_seance);
    const place = inscrit.statut === 'attente' ? "Votre place en liste d'attente a été retirée" : 'Votre inscription a été retirée';
    try {
        return await sendEmail(
            inscrit.email,
            `❌ Séance annulée - ${seance.nom}`,
            `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #c53030;">❌ Séance annulée</h2>
                <p>Bonjour ${echapperHtml(inscrit.prenom)} ${echapperHtml(inscrit.nom)},</p>
                <p>${contexte} : la séance
                   <strong>${echapperHtml(seance.nom)}</strong> du ${jour} (${seance.heure_debut} - ${seance.heure_fin})
                   n'aura pas lieu.</p>
                <p>${place} ; elle ne compte plus dans votre quota de la semaine.
                   Rendez-vous sur l'application pour choisir une autre séance.</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${getBaseUrl()}"
                       style="background: #28A0E8; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                        Voir les séances
                    </a>
                </div>
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                    ACC Triathlon - Gestion des créneaux
                </p>
            </div>
            `
        );
    } catch (err) {
        console.error(`❌ Erreur envoi email d'annulation à ${inscrit.email}:`, err.message);
        return false;
    }
};

// Les emails d'annulation partent en arrière-plan, espacés comme les autres
// envois groupés. Renvoie le nombre de personnes prévenues.
const prevenirAnnulations = (bilans, contexte) => {
    const aPrevenir = bilans.flatMap(bilan =>
        bilan.annulees.flatMap(({ seance, inscrits }) => inscrits.map(inscrit => ({ inscrit, seance }))));

    (async () => {
        for (const [index, { inscrit, seance }] of aPrevenir.entries()) {
            if (index > 0) await new Promise(r => setTimeout(r, DELAI_ENTRE_EMAILS_MS));
            await notifierAnnulation(inscrit, seance, contexte);
        }
    })().catch(err => console.error('❌ Erreur envoi des emails d\'annulation:', err));

    return aPrevenir.length;
};

// Message de résultat, emails d'annulation envoyés au passage
const messageBilans = (debut, bilans) => {
    const prevenues = prevenirAnnulations(bilans);
    const annulees = bilans.reduce((total, b) => total + b.annulees.length, 0);
    if (annulees === 0) return debut;
    return prevenues > 0
        ? `${debut}. ${annulees} séance(s) annulée(s), ${prevenues} personne(s) prévenue(s) par email.`
        : `${debut}. ${annulees} séance(s) annulée(s), sans inscrit à prévenir.`;
};

// Bilan d'un changement de semaine type, sans les coordonnées des inscrits
const resumeBilan = (bilan) => ({
    lundi: bilan.lundi,
    semaine_type: bilan.semaine_type,
    conservees: bilan.conservees,
    creees: bilan.creees,
    reactivees: bilan.reactivees,
    annulees: bilan.annulees.map(({ seance, inscrits }) => ({
        ...seance,
        inscrits: inscrits.map(i => ({ nom: i.nom, prenom: i.prenom, statut: i.statut }))
    })),
    personnes_concernees: bilan.annulees.reduce((total, a) => total + a.inscrits.length, 0)
});

const repondreErreur = (res, err, contexte) => {
    // Erreurs métier (semaines types, séances) : message destiné à l'admin
    if (err.metier) {
        return res.status(err.status).json({ error: err.message });
    }
    console.error(`Erreur ${contexte}:`, err);
    return res.status(500).json({ error: `Erreur lors de ${contexte}` });
};

app.get('/api/admin/semaines-types', requireAdmin, async (req, res) => {
    try {
        res.json(await semainesTypes.listerTypes(db));
    } catch (err) {
        repondreErreur(res, err, 'la récupération des semaines types');
    }
});

// Nouvelle semaine type, vide ou copiée d'une autre ({ nom, source_id })
app.post('/api/admin/semaines-types', requireAdmin, async (req, res) => {
    const { nom, source_id } = req.body;
    try {
        const semaineType = source_id
            ? await semainesTypes.dupliquerType(db, source_id, nom)
            : await semainesTypes.creerType(db, nom);
        const message = source_id
            ? `Semaine type « ${semaineType.nom} » créée avec ${semaineType.nb_creneaux} créneau(x)`
            : `Semaine type « ${semaineType.nom} » créée`;
        res.json({ message, semaine_type: semaineType });
    } catch (err) {
        repondreErreur(res, err, 'la création de la semaine type');
    }
});

app.put('/api/admin/semaines-types/:id', requireAdmin, async (req, res) => {
    try {
        const semaineType = await semainesTypes.renommerType(db, req.params.id, req.body.nom);
        res.json({ message: 'Semaine type renommée', semaine_type: semaineType });
    } catch (err) {
        repondreErreur(res, err, 'le renommage de la semaine type');
    }
});

// Nouvelle semaine type par défaut : les semaines à venir sans choix explicite la suivent
app.put('/api/admin/semaines-types/:id/defaut', requireAdmin, async (req, res) => {
    try {
        const bilans = await semainesTypes.definirParDefaut(db, req.params.id);
        res.json({
            message: messageBilans('Semaine type par défaut modifiée', bilans),
            semaines: bilans.map(resumeBilan)
        });
    } catch (err) {
        repondreErreur(res, err, 'le changement de semaine type par défaut');
    }
});

app.delete('/api/admin/semaines-types/:id', requireAdmin, async (req, res) => {
    try {
        await semainesTypes.supprimerType(db, req.params.id);
        res.json({ message: 'Semaine type supprimée' });
    } catch (err) {
        repondreErreur(res, err, 'la suppression de la semaine type');
    }
});

// Choisir les créneaux d'une semaine type ({ creneau_ids, simulation }).
// Les semaines à venir qui la suivent sont mises à jour.
app.put('/api/admin/semaines-types/:id/creneaux', requireAdmin, async (req, res) => {
    const { creneau_ids, simulation } = req.body;
    try {
        const bilans = await semainesTypes.definirCreneaux(db, req.params.id, creneau_ids, {
            simulation: simulation === true
        });
        if (simulation === true) {
            return res.json({ simulation: true, semaines: bilans.map(resumeBilan) });
        }
        res.json({
            message: messageBilans('Créneaux de la semaine type enregistrés', bilans),
            semaines: bilans.map(resumeBilan)
        });
    } catch (err) {
        repondreErreur(res, err, 'la mise à jour des créneaux de la semaine type');
    }
});

// Les semaines planifiables et la semaine type de chacune
app.get('/api/admin/semaines', requireAdmin, async (req, res) => {
    try {
        await seances.genererSemaines(db, seances.SEMAINES_ADMIN);
        res.json(await semainesTypes.planning(db));
    } catch (err) {
        repondreErreur(res, err, 'la récupération du planning');
    }
});

// Appliquer une semaine type à une semaine ({ semaine_type_id, simulation })
app.post('/api/admin/semaines/:lundi', requireAdmin, async (req, res) => {
    const { semaine_type_id, simulation } = req.body;
    if (!semaine_type_id) {
        return res.status(400).json({ error: 'Semaine type requise' });
    }

    try {
        const bilan = await semainesTypes.appliquerType(db, req.params.lundi, semaine_type_id, {
            simulation: simulation === true
        });
        const resume = resumeBilan(bilan);
        if (simulation === true) {
            return res.json({ simulation: true, bilan: resume });
        }

        const message = messageBilans(`Semaine type « ${bilan.semaine_type.nom} » appliquée`, [bilan]);
        console.log(`📅 Semaine du ${bilan.lundi} : ${message} (admin ${req.session.userId})`);
        res.json({ message, bilan: resume });
    } catch (err) {
        repondreErreur(res, err, "l'application de la semaine type");
    }
});
// --- AJUSTEMENTS D'UNE SÉANCE (ADMIN) ---

// Prévenir un inscrit qu'une séance change de date, d'horaire ou de lieu
const notifierModification = async (inscrit, seance, changements) => {
    const lignes = changements.map(c => {
        const [avant, apres] = c.type === 'date' ? [dateLisible(c.avant), dateLisible(c.apres)] : [c.avant, c.apres];
        return `<li><strong>${c.libelle}</strong> : ${echapperHtml(avant)} → <strong>${echapperHtml(apres)}</strong></li>`;
    }).join('');
    const place = inscrit.statut === 'attente' ? "Votre place en liste d'attente est conservée" : 'Votre inscription est conservée';

    try {
        return await sendEmail(
            inscrit.email,
            `✏️ Séance modifiée - ${seance.nom}`,
            `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #b7791f;">✏️ Séance modifiée</h2>
                <p>Bonjour ${echapperHtml(inscrit.prenom)} ${echapperHtml(inscrit.nom)},</p>
                <p>La séance <strong>${echapperHtml(seance.nom)}</strong> a été modifiée :</p>
                <ul>${lignes}</ul>
                <p>${place}. Si ce changement ne vous convient pas, désinscrivez-vous
                   depuis l'application pour libérer votre place.</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${getBaseUrl()}"
                       style="background: #28A0E8; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                        Voir mes inscriptions
                    </a>
                </div>
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                    ACC Triathlon - Gestion des créneaux
                </p>
            </div>
            `
        );
    } catch (err) {
        console.error(`❌ Erreur envoi email de modification à ${inscrit.email}:`, err.message);
        return false;
    }
};

const prevenirModifications = (inscrits, seance, changements) => {
    (async () => {
        for (const [index, inscrit] of inscrits.entries()) {
            if (index > 0) await new Promise(r => setTimeout(r, DELAI_ENTRE_EMAILS_MS));
            await notifierModification(inscrit, seance, changements);
        }
    })().catch(err => console.error('❌ Erreur envoi des emails de modification:', err));
    return inscrits.length;
};

// Capacité saisie : directe, en lignes d'eau, sinon celle par défaut du sport
const capaciteSaisie = async (sportId, champs) => (await resoudreCapaciteAvecSport(db, sportId, champs)) || 0;

// Séances d'une semaine du planning, annulées comprises
app.get('/api/admin/seances', requireAdmin, async (req, res) => {
    const offset = semaineDemandee(req.query.semaine, true);
    if (offset === null) {
        return res.status(400).json({ error: 'Semaine non consultable' });
    }

    try {
        const lundi = seances.lundiDeLaSemaine(offset);
        const dimanche = seances.ajouterJours(lundi, 6);
        await seances.genererSemaine(db, lundi);
        const liste = await seances.listerSeances(db, { debut: lundi, fin: dimanche, inclureAnnulees: true });
        res.json({ lundi, dimanche, seances: liste });
    } catch (err) {
        repondreErreur(res, err, 'la récupération des séances');
    }
});

// Séance ponctuelle, hors semaine type
app.post('/api/admin/seances', requireAdmin, async (req, res) => {
    try {
        const capacite_max = await capaciteSaisie(req.body.sport_id, req.body);
        const seance = await seancesAdmin.creerSeancePonctuelle(db, { ...req.body, capacite_max });
        console.log(`➕ Séance ponctuelle « ${seance.nom} » (${seance.date_seance}) ajoutée par l'admin ${req.session.userId}`);
        res.json({ message: `Séance « ${seance.nom} » ajoutée le ${dateLisible(seance.date_seance)}`, seance });
    } catch (err) {
        repondreErreur(res, err, "l'ajout de la séance");
    }
});

// Ajuster une séance précise ; elle ne suit plus son créneau
app.put('/api/admin/seances/:seanceId', requireAdmin, async (req, res) => {
    try {
        const actuelle = await seances.trouverSeance(db, req.params.seanceId);
        if (!actuelle) {
            return res.status(404).json({ error: 'Séance non trouvée' });
        }

        const capacite_max = await capaciteSaisie(actuelle.sport_id, req.body);
        const resultat = await seancesAdmin.modifierSeance(db, actuelle.id, { ...req.body, capacite_max });

        let message = 'Séance modifiée';
        if (resultat.inscrits.length > 0) {
            const prevenues = prevenirModifications(resultat.inscrits, resultat.seance, resultat.changements);
            message += `. ${prevenues} personne(s) prévenue(s) par email.`;
        }
        if (resultat.gainDePlaces) {
            const promus = await promouvoirSeances([actuelle.id]);
            for (const promu of promus) {
                notifierPromotion(promu.userId, promu.seance)
                    .catch(err => console.error('❌ Erreur envoi email de promotion:', err));
            }
            if (promus.length > 0) {
                message += ` ${promus.length} personne(s) en liste d'attente ont obtenu une place.`;
            }
        }

        res.json({ message, seance: resultat.seance, changements: resultat.changements });
    } catch (err) {
        repondreErreur(res, err, 'la modification de la séance');
    }
});

// Annuler une séance : inscrits désinscrits et prévenus
app.post('/api/admin/seances/:seanceId/annulation', requireAdmin, async (req, res) => {
    try {
        const { seance, inscrits } = await seancesAdmin.annulerSeance(db, req.params.seanceId);
        const prevenues = prevenirAnnulations([{ annulees: [{ seance, inscrits }] }], 'Le club a annulé une séance');
        console.log(`❌ Séance « ${seance.nom} » (${seance.date_seance}) annulée par l'admin ${req.session.userId} (${prevenues} personne(s) prévenue(s))`);

        const message = prevenues > 0
            ? `Séance annulée. ${prevenues} personne(s) désinscrite(s) et prévenue(s) par email.`
            : 'Séance annulée';
        res.json({ message, seance });
    } catch (err) {
        repondreErreur(res, err, "l'annulation de la séance");
    }
});

app.delete('/api/admin/seances/:seanceId/annulation', requireAdmin, async (req, res) => {
    try {
        const seance = await seancesAdmin.retablirSeance(db, req.params.seanceId);
        res.json({ message: 'Séance rétablie : les inscriptions sont de nouveau ouvertes', seance });
    } catch (err) {
        repondreErreur(res, err, 'le rétablissement de la séance');
    }
});
const envoyerInscritsSeance = async (res, seance) => {
    if (!seance) {
        return res.status(404).json({ error: 'Séance non trouvée' });
    }

    const rows = await db.query(
        `SELECT u.nom, u.prenom, i.statut, i.position_attente
         FROM inscriptions i
         JOIN users u ON i.user_id = u.id
         WHERE i.seance_id = ?
         ORDER BY
             CASE WHEN i.statut = 'inscrit' THEN 0 ELSE 1 END,
             i.position_attente ASC,
             i.created_at ASC`,
        [seance.id]
    );
    res.json(rows);
};

// Inscrits d'une séance, visibles des membres connectés
app.get('/api/seances/:seanceId/inscrits', requireAuth, async (req, res) => {
    try {
        await envoyerInscritsSeance(res, await seances.trouverSeance(db, req.params.seanceId));
    } catch (err) {
        console.error('Erreur récupération inscrits publics:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des inscrits' });
    }
});

// Ancienne forme (créneau + date), pour les pages ouvertes avant la mise à jour
app.get('/api/creneaux/:creneauId/inscrits', requireAuth, async (req, res) => {
    if (!req.query.date_seance) {
        return res.status(400).json({ error: 'La date de séance est requise' });
    }

    try {
        const seance = await seances.trouverSeanceParCreneau(db, req.params.creneauId, req.query.date_seance);
        await envoyerInscritsSeance(res, seance);
    } catch (err) {
        console.error('Erreur récupération inscrits publics:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des inscrits' });
    }
});

// Inscriptions du membre, de la séance la plus proche à la plus lointaine
app.get('/api/mes-inscriptions', requireAuth, async (req, res) => {
    try {
        const rows = await db.query(
            `SELECT i.id, i.user_id, i.seance_id, i.creneau_id, i.statut, i.position_attente, i.created_at,
                    s.date_seance, s.nom, s.heure_debut, s.heure_fin, s.lieu, s.sport_id,
                    sp.nom AS sport_nom, sp.icone AS sport_icone, sp.couleur AS sport_couleur
             FROM inscriptions i
             JOIN seances s ON i.seance_id = s.id
             LEFT JOIN sports sp ON s.sport_id = sp.id
             WHERE i.user_id = ?
             ORDER BY s.date_seance, s.heure_debut`,
            [req.session.userId]
        );

        res.json(rows.map(row => {
            const date = seances.normaliserDate(row.date_seance);
            return { ...row, date_seance: date, jour_semaine: seances.jourSemaineDe(date) };
        }));
    } catch (err) {
        console.error('Erreur SQL mes-inscriptions:', err.message);
        return res.status(500).json({
            error: 'Erreur lors de la récupération des inscriptions'
        });
    }
});
// Servir les fichiers statiques
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route pour servir la page d'inscription via token
app.get('/inscription-attente', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'inscription-attente.html'));
});

// Route pour servir la page de réinitialisation de mot de passe via token
app.get('/reset-password', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

// Gestion des erreurs non capturées
process.on('uncaughtException', (error) => {
    console.error('❌ Erreur non capturée:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesse rejetée non gérée:', reason);
});

// Les tests d'intégration attendent la fin de l'initialisation
app.locals.dbPrete = dbPrete;
app.locals.db = db;
module.exports = app; // Mettre à disposition l'application pour les tests (Supertest)

if (require.main === module) {
    const server = app.listen(PORT, () => {
        console.log(`✅ Serveur démarré sur le port ${PORT} `);
        console.log(`🌍 Environnement: ${process.env.NODE_ENV || 'development'} `);

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
                `UPDATE meta_rules_config SET enabled = ?, description = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? `,
                `UPDATE meta_rules_config SET enabled = ?, description = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? `
            );
            await db.run(updateSQL, [enabled, description, userId]);
        } else {
            await db.run(`INSERT INTO meta_rules_config(enabled, description, updated_by) VALUES(?, ?, ?)`,
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
            INSERT INTO meta_rules(licence_type, jour_source, jours_interdits, description, created_by) 
            VALUES(?, ?, ?, ?, ?)
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
        await db.run(`DELETE FROM meta_rules WHERE id = ? `, [id]);
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
        await db.run(`UPDATE meta_rules SET active = NOT active WHERE id = ? `, [id]);
        res.json({ message: 'Statut de la règle mis à jour' });
    } catch (err) {
        console.error('Erreur toggle méta-règle:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Route de création de créneaux (ADMIN)
app.post('/api/creneaux', requireAdmin, async (req, res) => {
    const { nom, sport_id, jour_semaine, heure_debut, heure_fin, capacite_max, sans_limite, lieu, nombre_lignes, personnes_par_ligne, public_cible } = req.body;
    const semaineTypeIds = [].concat(req.body.semaine_type_ids || []).filter(Boolean);
    const sansLimite = sans_limite === true || sans_limite === 'true';
    const lieuNettoye = (lieu || '').trim() || null;

    // jour_semaine vaut 0 le dimanche : tester la présence, pas la véracité
    if (!nom || jour_semaine === undefined || jour_semaine === null || jour_semaine === '' || !heure_debut || !heure_fin) {
        return res.status(400).json({ error: 'Tous les champs obligatoires doivent être remplis' });
    }

    const cibles = ['jeune', 'adulte', 'les deux'];
    const varCible = (public_cible && cibles.includes(public_cible)) ? public_cible : 'les deux';

    try {
        for (const typeId of semaineTypeIds) {
            if (!(await semainesTypes.trouverType(db, typeId))) {
                return res.status(400).json({ error: 'Semaine type inconnue' });
            }
        }

        // Sans sport explicite, on rattache à la natation (sport historique)
        let sportId = sport_id;
        if (!sportId) {
            const natation = await db.get(
                db.adaptSQL(`SELECT id FROM sports WHERE slug = ?`, `SELECT id FROM sports WHERE slug = $1`),
                ['natation']
            );
            sportId = natation ? natation.id : null;
        }

        // Un créneau sans limite garde une capacité de façade, jamais utilisée pour bloquer
        let capaciteMax = await resoudreCapaciteAvecSport(db, sportId, { capacite_max, nombre_lignes, personnes_par_ligne });
        if (!capaciteMax) {
            if (!sansLimite) {
                return res.status(400).json({ error: 'Indiquez une capacité, ou un nombre de lignes et de personnes par ligne' });
            }
            capaciteMax = 0;
        }

        const sql = db.isPostgres ?
            `INSERT INTO creneaux(nom, sport_id, jour_semaine, heure_debut, heure_fin, nombre_lignes, personnes_par_ligne, capacite_max, sans_limite, lieu, public_cible)
             VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id` :
            `INSERT INTO creneaux(nom, sport_id, jour_semaine, heure_debut, heure_fin, nombre_lignes, personnes_par_ligne, capacite_max, sans_limite, lieu, public_cible)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const result = await db.run(sql, [
            nom,
            sportId,
            jour_semaine,
            heure_debut,
            heure_fin,
            nombre_lignes || null,
            personnes_par_ligne || null,
            capaciteMax,
            sansLimite,
            lieuNettoye,
            varCible
        ]);

        const creneauId = result.lastID || result.id;
        // Sa séance apparaîtra dans les semaines qui suivent ces semaines types
        await semainesTypes.ajouterCreneauAuxTypes(db, creneauId, semaineTypeIds);

        res.json({
            message: 'Créneau ajouté',
            creneauId
        });
    } catch (err) {
        console.error('Erreur ajout créneau:', err);
        res.status(500).json({ error: 'Erreur lors de l\'ajout du créneau' });
    }
});


// Route de modification de créneaux (ADMIN)
app.put('/api/creneaux/:creneauId', requireAdmin, async (req, res) => {
    const creneauId = req.params.creneauId;
    const { nom, sport_id, jour_semaine, heure_debut, heure_fin, capacite_max, sans_limite, lieu, nombre_lignes, personnes_par_ligne, public_cible } = req.body;
    const sansLimite = sans_limite === true || sans_limite === 'true';
    const lieuNettoye = (lieu || '').trim() || null;

    // jour_semaine vaut 0 le dimanche : tester la présence, pas la véracité
    if (!nom || jour_semaine === undefined || jour_semaine === null || jour_semaine === '' || !heure_debut || !heure_fin) {
        return res.status(400).json({ error: 'Tous les champs obligatoires doivent être remplis' });
    }

    const cibles = ['jeune', 'adulte', 'les deux'];
    const varCible = (public_cible && cibles.includes(public_cible)) ? public_cible : 'les deux';

    try {
        const creneauExistant = await db.get(
            db.adaptSQL(
                `SELECT sport_id, capacite_max, sans_limite FROM creneaux WHERE id = ?`,
                `SELECT sport_id, capacite_max, sans_limite FROM creneaux WHERE id = $1`
            ),
            [creneauId]
        );

        if (!creneauExistant) {
            return res.status(404).json({ error: 'Créneau non trouvé' });
        }

        const capaciteAvant = parseInt(creneauExistant.capacite_max, 10) || 0;
        const etaitSansLimite = creneauExistant.sans_limite === true || creneauExistant.sans_limite === 1;

        // Le sport peut changer (créneaux créés en natation faute de mieux)
        const sportId = sport_id || creneauExistant.sport_id;
        const sportChange = String(sportId) !== String(creneauExistant.sport_id);

        let capaciteMax = await resoudreCapaciteAvecSport(db, sportId, { capacite_max, nombre_lignes, personnes_par_ligne });
        if (!capaciteMax) {
            if (!sansLimite) {
                return res.status(400).json({ error: 'Indiquez une capacité, ou un nombre de lignes et de personnes par ligne' });
            }
            capaciteMax = 0;
        }

        const sql = db.isPostgres ?
            `UPDATE creneaux SET nom = $1, sport_id = $2, jour_semaine = $3, heure_debut = $4, heure_fin = $5, nombre_lignes = $6, personnes_par_ligne = $7, capacite_max = $8, sans_limite = $9, lieu = $10, public_cible = $11 WHERE id = $12` :
            `UPDATE creneaux SET nom = ?, sport_id = ?, jour_semaine = ?, heure_debut = ?, heure_fin = ?, nombre_lignes = ?, personnes_par_ligne = ?, capacite_max = ?, sans_limite = ?, lieu = ?, public_cible = ? WHERE id = ? `;

        await db.run(sql, [
            nom,
            sportId,
            jour_semaine,
            heure_debut,
            heure_fin,
            nombre_lignes || null,
            personnes_par_ligne || null,
            capaciteMax,
            sansLimite,
            lieuNettoye,
            varCible,
            creneauId
        ]);

        // Un bloc appartient à un sport : un créneau qui change de discipline
        // doit sortir des blocs d'une autre, sinon la règle « un créneau par
        // bloc » continuerait de le contraindre.
        let detacheDuBloc = false;
        if (sportChange) {
            const retrait = await db.run(
                db.adaptSQL(
                    `DELETE FROM bloc_creneaux WHERE creneau_id = ?
                     AND bloc_id IN (SELECT id FROM blocs WHERE sport_id IS NULL OR sport_id != ?)`,
                    `DELETE FROM bloc_creneaux WHERE creneau_id = $1
                     AND bloc_id IN (SELECT id FROM blocs WHERE sport_id IS NULL OR sport_id != $2)`
                ),
                [creneauId, sportId]
            );
            detacheDuBloc = retrait.changes > 0;
            if (detacheDuBloc) {
                console.log(`🗂 Créneau ${creneauId} retiré de son bloc (changement de sport)`);
            }
        }

        // Les séances à venir suivent le créneau, sauf celles ajustées à la main
        const seancesMisesAJour = await seances.synchroniserCreneau(db, creneauId);

        // Places gagnées (capacité augmentée ou passage sans limite) : repourvoir
        // la liste d'attente dans l'ordre, sans attendre une action de l'admin.
        let promus = [];
        const gainDePlaces = (sansLimite && !etaitSansLimite) || capaciteMax > capaciteAvant;
        if (gainDePlaces) {
            promus = await promouvoirSeances(seancesMisesAJour);

            // Les emails ne doivent pas faire échouer la modification
            for (const promu of promus) {
                notifierPromotion(promu.userId, promu.seance)
                    .catch(err => console.error('❌ Erreur envoi email de promotion:', err));
            }
        }

        const messages = ['Créneau mis à jour'];
        if (detacheDuBloc) {
            messages.push('Il a été retiré de son bloc hebdomadaire, qui relève d\'un autre sport.');
        }
        if (promus.length > 0) {
            messages.push(`${promus.length} personne(s) en liste d'attente ont été inscrites et notifiées par email.`);
        }

        res.json({ message: messages.join(' '), promus: promus.length });
    } catch (err) {
        console.error('Erreur modification créneau:', err);
        res.status(500).json({ error: 'Erreur lors de la modification' });
    }
});


// Supprime un créneau et tout ce qui en dépend : ses séances (passées
// comprises), leurs jetons de liste d'attente et leurs inscriptions.
// PostgreSQL impose cet ordre à cause des clés étrangères.
const supprimerCreneauEtSeances = async (creneauId) => {
    const seancesDuCreneau = `SELECT id FROM seances WHERE creneau_id = ?`;
    await db.run(`DELETE FROM inscriptions WHERE creneau_id = ? OR seance_id IN (${seancesDuCreneau})`, [creneauId, creneauId]);
    await db.run(`DELETE FROM waitlist_tokens WHERE creneau_id = ? OR seance_id IN (${seancesDuCreneau})`, [creneauId, creneauId]);
    await db.run(`DELETE FROM seances WHERE creneau_id = ?`, [creneauId]);
    await db.run(`DELETE FROM semaine_type_creneaux WHERE creneau_id = ?`, [creneauId]);
    await db.run(`DELETE FROM bloc_creneaux WHERE creneau_id = ?`, [creneauId]);
    return db.run(`DELETE FROM creneaux WHERE id = ?`, [creneauId]);
};

// Route de suppression de créneaux (ADMIN)
app.delete('/api/creneaux/:creneauId', requireAdmin, async (req, res) => {
    const creneauId = req.params.creneauId;

    console.log('Tentative de suppression du créneau:', creneauId);

    try {
        // Refuser tant que des membres sont inscrits à l'une de ses séances
        const result = await db.get(
            `SELECT COUNT(*) as count FROM inscriptions
             WHERE creneau_id = ? OR seance_id IN (SELECT id FROM seances WHERE creneau_id = ?)`,
            [creneauId, creneauId]
        );
        const nbInscriptions = parseInt(result && result.count, 10) || 0;

        if (nbInscriptions > 0) {
            return res.status(400).json({
                error: `Impossible de supprimer ce créneau car ${nbInscriptions} personne(s) y sont inscrites. Veuillez d'abord les désinscrire.`
            });
        }

        const deleteResult = await supprimerCreneauEtSeances(creneauId);

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
        const deleteResult = await supprimerCreneauEtSeances(creneauId);

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
// --- GESTION DES UTILISATEURS (ADMIN) ---

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const sql = db.isPostgres ?
            `SELECT u.id, u.email, u.nom, u.prenom, u.role, u.licence_type, u.public_cible, u.created_at,
                    COUNT(i.id) as nb_inscriptions
             FROM users u
             LEFT JOIN inscriptions i ON u.id = i.user_id
             GROUP BY u.id
             ORDER BY u.nom, u.prenom` :
            `SELECT u.id, u.email, u.nom, u.prenom, u.role, u.licence_type, u.public_cible, u.created_at,
                    COUNT(i.id) as nb_inscriptions
             FROM users u
             LEFT JOIN inscriptions i ON u.id = i.user_id
             GROUP BY u.id
             ORDER BY u.nom, u.prenom`;

        const users = await db.query(sql, []);
        res.json(users);
    } catch (err) {
        console.error('Erreur liste utilisateurs:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs' });
    }
});

// Route de création manuelle d'utilisateur (ADMIN)
app.post('/api/admin/users', requireAdmin, async (req, res) => {
    const { email, password, nom, prenom, licence_type, public_cible, role } = req.body;

    if (!email || !password || !nom || !prenom || !licence_type) {
        return res.status(400).json({ error: 'Tous les champs obligatoires doivent être remplis' });
    }

    const licencesValides = ['Compétition', 'Loisir/Senior', 'Benjamins/Junior', 'Poussins/Pupilles'];
    if (!licencesValides.includes(licence_type)) {
        return res.status(400).json({ error: 'Type de licence invalide' });
    }

    const cibles = ['jeune', 'adulte', 'les deux'];
    const pCible = (public_cible && cibles.includes(public_cible)) ? public_cible : 'adulte';

    const rolesValides = ['membre', 'admin'];
    const userRole = (role && rolesValides.includes(role)) ? role : 'membre';

    const hashedPassword = bcrypt.hashSync(password, 10);

    try {
        const sql = db.isPostgres ?
            `INSERT INTO users (email, password, nom, prenom, licence_type, public_cible, role) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id` :
            `INSERT INTO users (email, password, nom, prenom, licence_type, public_cible, role) VALUES (?, ?, ?, ?, ?, ?, ?)`;

        const result = await db.run(sql, [normaliserEmail(email), hashedPassword, nom, prenom, licence_type, pCible, userRole]);

        res.json({
            message: 'Utilisateur créé avec succès',
            userId: result.lastID || result.id
        });
    } catch (err) {
        if (err.message && (err.message.includes('UNIQUE constraint failed') || err.message.includes('duplicate key'))) {
            return res.status(400).json({ error: 'Email déjà utilisé' });
        }
        console.error('Erreur création compte manuel:', err);
        return res.status(500).json({ error: 'Erreur lors de la création de l\'utilisateur' });
    }
});

// --- IMPORT EN MASSE DE COMPTES (ADMIN) ---

// Le lien « définir mon mot de passe » d'un compte importé doit survivre à
// quelques jours d'inattention, contrairement au lien de réinitialisation.
const VALIDITE_LIEN_BIENVENUE_JOURS = 7;
// Resend limite à 2 requêtes/s : on espace les envois.
const DELAI_ENTRE_EMAILS_MS = 600;

const ENTITES_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
const echapperHtml = (texte) => String(texte ?? '').replace(/[&<>"']/g, c => ENTITES_HTML[c]);

const emailsExistants = async () => {
    const rows = await db.query(`SELECT LOWER(email) AS email FROM users`, []);
    return rows.map(r => r.email);
};

const lignesImportValides = (lignes, res) => {
    if (!Array.isArray(lignes) || lignes.length === 0) {
        res.status(400).json({ error: 'Aucune ligne à importer' });
        return false;
    }
    if (lignes.length > importComptes.MAX_LIGNES) {
        res.status(400).json({ error: `Fichier trop volumineux : ${importComptes.MAX_LIGNES} lignes maximum` });
        return false;
    }
    return true;
};

// Envoi en arrière-plan : un import de plusieurs centaines de comptes
// dépasserait sinon le délai d'une requête HTTP.
const envoyerEmailsBienvenue = async (destinataires) => {
    let envoyes = 0;
    for (const [index, dest] of destinataires.entries()) {
        if (index > 0) await new Promise(r => setTimeout(r, DELAI_ENTRE_EMAILS_MS));

        const lien = `${getBaseUrl()}/reset-password?token=${dest.token}&bienvenue=1`;
        const contenu = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #28A0E8;">👋 Bienvenue sur la plateforme de réservation</h2>

                <p>Bonjour ${echapperHtml(dest.prenom)} ${echapperHtml(dest.nom)},</p>

                <p>Votre club vous a créé un compte pour réserver vos séances d'entraînement.
                Pour l'activer, choisissez votre mot de passe :</p>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="${lien}"
                       style="background: #28A0E8; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                        Définir mon mot de passe
                    </a>
                </div>

                <p style="color: #6b7280; font-size: 14px;">
                    Votre identifiant de connexion est votre adresse email : <strong>${echapperHtml(dest.email)}</strong><br>
                    ⚠️ Ce lien expire dans ${VALIDITE_LIEN_BIENVENUE_JOURS} jours. Passé ce délai,
                    utilisez « Mot de passe oublié » sur la page de connexion.
                </p>

                <hr style="margin: 30px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                    ACC Triathlon - Gestion des créneaux
                </p>
            </div>
        `;

        try {
            if (await sendEmail(dest.email, '👋 Votre compte ACC Triathlon est prêt', contenu)) {
                envoyes++;
            } else {
                console.error(`❌ Échec envoi email de bienvenue à ${dest.email}`);
            }
        } catch (err) {
            console.error(`❌ Erreur envoi email de bienvenue à ${dest.email}:`, err.message);
        }
    }
    console.log(`📧 Emails de bienvenue : ${envoyes}/${destinataires.length} envoyé(s)`);
};

// Étape 1 : aperçu. Reçoit les lignes brutes du fichier ({ en-tête: valeur })
// et renvoie ce que l'import ferait de chacune, sans rien écrire.
app.post('/api/admin/users/import/apercu', requireAdmin, async (req, res) => {
    const { lignes, defauts } = req.body;
    if (!lignesImportValides(lignes, res)) return;

    try {
        const { colonnes, lignes: extraites } = importComptes.extraireLignes(lignes);
        const champsTrouves = Object.values(colonnes);
        const colonnesManquantes = ['nom', 'prenom', 'email'].filter(c => !champsTrouves.includes(c));

        if (colonnesManquantes.length > 0) {
            return res.status(400).json({
                error: `Colonnes introuvables dans le fichier : ${colonnesManquantes.join(', ')}`,
                colonnes
            });
        }

        const analyse = importComptes.analyserLignes(extraites, await emailsExistants(), defauts || {});
        res.json({ colonnes, lignes: analyse, resume: importComptes.resumer(analyse) });
    } catch (err) {
        console.error('Erreur aperçu import comptes:', err);
        res.status(500).json({ error: `Erreur lors de l'analyse du fichier` });
    }
});

// Étape 2 : import. Reçoit les lignes de l'aperçu, éventuellement corrigées
// par l'admin (licence, public), et les revalide avant d'écrire.
// Avec `simulation`, renvoie seulement la nouvelle analyse : l'aperçu s'en sert
// après chaque correction, sans dupliquer les règles de validation côté client.
app.post('/api/admin/users/import', requireAdmin, async (req, res) => {
    const { lignes, mettreAJourExistants = false, envoyerEmails = true, simulation = false } = req.body;
    if (!lignesImportValides(lignes, res)) return;

    try {
        const analyse = importComptes.analyserLignes(lignes, await emailsExistants());
        if (simulation) {
            return res.json({ lignes: analyse, resume: importComptes.resumer(analyse) });
        }

        const resultat = { crees: 0, misAJour: 0, ignores: 0, erreurs: [] };
        const destinataires = [];
        const expiration = new Date();
        expiration.setDate(expiration.getDate() + VALIDITE_LIEN_BIENVENUE_JOURS);

        for (const ligne of analyse) {
            if (ligne.statut === 'erreur') {
                resultat.erreurs.push({ ligne: ligne.ligne, email: ligne.email, erreurs: ligne.erreurs });
                continue;
            }

            if (ligne.statut === 'doublon' || (ligne.statut === 'existant' && !mettreAJourExistants)) {
                resultat.ignores++;
                continue;
            }

            try {
                if (ligne.statut === 'existant') {
                    await db.run(
                        db.adaptSQL(
                            `UPDATE users SET licence_type = ?, public_cible = ? WHERE LOWER(email) = ?`,
                            `UPDATE users SET licence_type = $1, public_cible = $2 WHERE LOWER(email) = $3`
                        ),
                        [ligne.licence_type, ligne.public_cible, ligne.email]
                    );
                    resultat.misAJour++;
                    continue;
                }

                // Mot de passe aléatoire jamais communiqué : le membre choisit
                // le sien via le lien reçu par email.
                const motDePasse = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
                const creation = await db.run(
                    db.adaptSQL(
                        `INSERT INTO users (email, password, nom, prenom, licence_type, public_cible, role) VALUES (?, ?, ?, ?, ?, ?, 'membre')`,
                        `INSERT INTO users (email, password, nom, prenom, licence_type, public_cible, role) VALUES ($1, $2, $3, $4, $5, $6, 'membre') RETURNING id`
                    ),
                    [ligne.email, motDePasse, ligne.nom, ligne.prenom, ligne.licence_type, ligne.public_cible]
                );
                const userId = creation.lastID || creation.id;
                resultat.crees++;

                if (envoyerEmails) {
                    const token = generateSecureToken();
                    await db.run(`INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)`,
                        [token, userId, expiration.toISOString()]);
                    destinataires.push({ ...ligne, token });
                }
            } catch (err) {
                // Compte créé entre l'analyse et l'écriture : on ne l'écrase pas
                if (err.message && (err.message.includes('UNIQUE constraint failed') || err.message.includes('duplicate key'))) {
                    resultat.ignores++;
                } else {
                    console.error(`Erreur import ligne ${ligne.ligne}:`, err);
                    resultat.erreurs.push({ ligne: ligne.ligne, email: ligne.email, erreurs: [`Erreur lors de l'écriture en base`] });
                }
            }
        }

        console.log(`👥 Import de comptes par l'admin ${req.session.userId} : ${resultat.crees} créé(s), ${resultat.misAJour} mis à jour, ${resultat.ignores} ignoré(s), ${resultat.erreurs.length} en erreur`);

        if (destinataires.length > 0) {
            envoyerEmailsBienvenue(destinataires).catch(err =>
                console.error('❌ Erreur envoi des emails de bienvenue:', err));
        }

        res.json({ ...resultat, emailsEnvoyes: destinataires.length });
    } catch (err) {
        console.error('Erreur import comptes:', err);
        res.status(500).json({ error: `Erreur lors de l'import des comptes` });
    }
});

app.put('/api/admin/users/:userId/role', requireAdmin, async (req, res) => {
    const userId = req.params.userId;
    const { role, public_cible } = req.body;

    if (!role && !public_cible) {
        return res.status(400).json({ error: 'Rôle ou public cible invalide' });
    }

    try {
        // Empêcher un admin de s'enlever ses propres droits
        if (role && role !== 'admin' && parseInt(userId) === req.session.userId) {
            return res.status(403).json({ error: 'Vous ne pouvez pas retirer vos propres droits administrateur' });
        }

        // Mettre à jour progressivement selon ce qui est fourni
        let updates = [];
        let values = [];
        let index = 1;

        if (role && ['admin', 'membre'].includes(role)) {
            updates.push(`role = ${db.isPostgres ? '$' + index++ : '?'}`);
            values.push(role);
        }

        if (public_cible && ['jeune', 'adulte', 'les deux'].includes(public_cible)) {
            updates.push(`public_cible = ${db.isPostgres ? '$' + index++ : '?'}`);
            values.push(public_cible);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Données invalides fournies.' });
        }

        values.push(userId); // Pour la clause WHERE

        const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ${db.isPostgres ? '$' + index : '?'}`;

        const result = await db.run(sql, values);

        res.json({ message: 'Profil utilisateur mis à jour avec succès' });
    } catch (err) {
        console.error('Erreur modification profil admin:', err);
        return res.status(500).json({ error: 'Erreur serveur' });
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
    // Le quota est hebdomadaire : il dépend de la semaine consultée (0 = courante, 1 = suivante)
    const offsetSemaines = parseInt(req.query.semaine || '0', 10) || 0;
    const dateRef = seances.lundiDeLaSemaine(offsetSemaines);

    try {
        // Un quota par sport contraint : aujourd'hui la natation seule, mais
        // l'interface suivra si le club en configure d'autres.
        const user = await db.get(
            db.adaptSQL(`SELECT licence_type FROM users WHERE id = ?`, `SELECT licence_type FROM users WHERE id = $1`),
            [userId]
        );

        if (!user) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }

        const sportsContraints = await db.query(
            db.adaptSQL(
                `SELECT s.id, s.nom, s.icone FROM licence_limits ll
                 JOIN sports s ON ll.sport_id = s.id
                 WHERE ll.licence_type = ? AND s.actif = 1
                 ORDER BY s.ordre`,
                `SELECT s.id, s.nom, s.icone FROM licence_limits ll
                 JOIN sports s ON ll.sport_id = s.id
                 WHERE ll.licence_type = $1 AND s.actif = true
                 ORDER BY s.ordre`
            ),
            [user.licence_type]
        );

        const limites = [];
        for (const sport of sportsContraints) {
            const quota = await verifierLimitesSeances(db, userId, sport.id, dateRef);
            if (quota.limiteApplicable) {
                limites.push({ sportId: sport.id, sportNom: sport.nom, sportIcone: sport.icone, ...quota });
            }
        }

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
            `SELECT id FROM users WHERE LOWER(email) = $1 AND id != $2` :
            `SELECT id FROM users WHERE LOWER(email) = ? AND id != ?`;

        const existingUser = await db.get(checkEmailSql, [normaliserEmail(email), userId]);

        if (existingUser) {
            return res.status(400).json({ error: 'Cet email est déjà utilisé par un autre utilisateur' });
        }

        // Mettre à jour le profil
        const updateSql = db.isPostgres ?
            `UPDATE users SET nom = $1, prenom = $2, email = $3 WHERE id = $4` :
            `UPDATE users SET nom = ?, prenom = ?, email = ? WHERE id = ?`;

        const result = await db.run(updateSql, [nom, prenom, normaliserEmail(email), userId]);

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
                `SELECT c.id, c.nom, c.jour_semaine, c.heure_debut, c.heure_fin, c.capacite_max
                 FROM creneaux c JOIN bloc_creneaux bc ON c.id = bc.creneau_id
                 WHERE bc.bloc_id = $1 ORDER BY CASE WHEN c.jour_semaine = 0 THEN 7 ELSE c.jour_semaine END, c.heure_debut` :
                `SELECT c.id, c.nom, c.jour_semaine, c.heure_debut, c.heure_fin, c.capacite_max
                 FROM creneaux c JOIN bloc_creneaux bc ON c.id = bc.creneau_id
                 WHERE bc.bloc_id = ? ORDER BY CASE WHEN c.jour_semaine = 0 THEN 7 ELSE c.jour_semaine END, c.heure_debut`;
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
        // Un bloc ne regroupe que des créneaux de son propre sport
        if (creneauxIds.length > 0) {
            const bloc = await db.get(
                db.adaptSQL(`SELECT sport_id FROM blocs WHERE id = ?`, `SELECT sport_id FROM blocs WHERE id = $1`),
                [blocId]
            );

            if (bloc && bloc.sport_id) {
                const placeholders = creneauxIds.map((_, i) => db.isPostgres ? `$${i + 2}` : '?').join(',');
                const intrus = await db.query(
                    `SELECT c.nom FROM creneaux c
                     WHERE c.id IN (${placeholders})
                       AND (c.sport_id IS NULL OR c.sport_id != ${db.isPostgres ? '$1' : '?'})`,
                    db.isPostgres ? [bloc.sport_id, ...creneauxIds] : [...creneauxIds, bloc.sport_id]
                );

                if (intrus.length > 0) {
                    return res.status(400).json({
                        error: `Ces créneaux relèvent d'un autre sport et ne peuvent pas rejoindre ce bloc : ${intrus.map(c => c.nom).join(', ')}`
                    });
                }
            }
        }

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
            ORDER BY CASE WHEN c.jour_semaine = 0 THEN 7 ELSE c.jour_semaine END, c.heure_debut
        `;
        const rows = await db.query(sql, []);
        res.json(rows);
    } catch (err) {
        console.error('Erreur récupération créneaux sans bloc:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// --- INSCRIPTIONS D'UNE SÉANCE ---

// Séance désignée par l'URL ; répond 404 si elle n'existe pas
const seanceDeLaRoute = async (req, res) => {
    const seance = await seances.trouverSeance(db, req.params.seanceId);
    if (!seance) res.status(404).json({ error: 'Séance non trouvée' });
    return seance;
};

// Une place s'est libérée : toute la liste d'attente est prévenue, le premier
// à confirmer via son lien l'obtient. Renvoie le nombre d'emails envoyés.
const notifierListeAttente = async (seance) => {
    const enAttente = await db.query(
        `SELECT user_id FROM inscriptions WHERE seance_id = ? AND statut = 'attente' ORDER BY position_attente ASC`,
        [seance.id]
    );

    let envoyes = 0;
    for (const { user_id } of enAttente) {
        if (await notifyWaitlistUser(user_id, seance)) envoyes++;
    }
    if (enAttente.length > 0) {
        console.log(`📧 ${envoyes}/${enAttente.length} personne(s) en liste d'attente notifiée(s)`);
    }
    return envoyes;
};

const seanceAVenir = (seance) => !seance.annulee && seance.date_seance >= seances.aujourdhuiIso();

// Inscrits et liste d'attente d'une séance (ADMIN)
app.get('/api/admin/seances/:seanceId/inscriptions', requireAdmin, async (req, res) => {
    try {
        const seance = await seanceDeLaRoute(req, res);
        if (!seance) return;

        const inscriptions = await db.query(
            `SELECT i.*, u.nom, u.prenom, u.email
             FROM inscriptions i
             JOIN users u ON i.user_id = u.id
             WHERE i.seance_id = ?
             ORDER BY
                 CASE WHEN i.statut = 'inscrit' THEN 0 ELSE 1 END,
                 i.position_attente ASC,
                 i.created_at ASC`,
            [seance.id]
        );
        res.json({ seance, inscriptions });
    } catch (err) {
        console.error('Erreur récupération inscriptions:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des inscriptions' });
    }
});

// Inscrire un membre à une séance (ADMIN). L'admin passe outre la capacité
// et les méta-règles, dont il est seulement averti.
app.post('/api/admin/inscriptions', requireAdmin, async (req, res) => {
    const { email, seanceId, creneauId, date_seance } = req.body;

    if (!email || !(seanceId || (creneauId && date_seance))) {
        return res.status(400).json({ error: 'Email et séance requis' });
    }

    try {
        const seance = await seances.resoudreSeance(db, req.body);
        if (!seance) {
            return res.status(404).json({ error: 'Séance non trouvée' });
        }

        const user = await db.get(`SELECT id FROM users WHERE LOWER(email) = ?`, [email.trim().toLowerCase()]);
        if (!user) {
            return res.status(404).json({ error: 'Utilisateur non trouvé avec cet email' });
        }

        const existante = await db.get(
            `SELECT id FROM inscriptions WHERE user_id = ? AND seance_id = ?`,
            [user.id, seance.id]
        );
        if (existante) {
            return res.status(400).json({ error: 'Cet utilisateur est déjà inscrit à cette séance' });
        }

        const metaReglesCheck = await verifierMetaRegles(db, user.id, seance);
        if (!metaReglesCheck.autorise) {
            console.log('⚠️ Admin outrepasse méta-règle:', metaReglesCheck.message);
        }

        await db.run(
            `INSERT INTO inscriptions (user_id, creneau_id, seance_id, date_seance, statut) VALUES (?, ?, ?, ?, 'inscrit')`,
            [user.id, seance.creneau_id, seance.id, seance.date_seance]
        );

        console.log('Inscription admin réussie:', { email, seanceId: seance.id });

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

// Retirer un membre d'une séance (ADMIN)
app.delete('/api/admin/seances/:seanceId/inscriptions/:userId', requireAdmin, async (req, res) => {
    try {
        const seance = await seanceDeLaRoute(req, res);
        if (!seance) return;

        const retrait = await seances.retirerInscription(db, seance.id, req.params.userId);
        if (!retrait) {
            return res.status(404).json({ error: 'Inscription non trouvée' });
        }

        console.log('Désinscription admin réussie:', { userId: req.params.userId, seanceId: seance.id });

        let message = 'Utilisateur désinscrit avec succès';
        if (retrait.placeLiberee && seanceAVenir(seance)) {
            const envoyes = await notifierListeAttente(seance);
            if (envoyes > 0) message += `. ${envoyes} personne(s) en liste d'attente ont été notifiées par email.`;
        }
        res.json({ message });
    } catch (err) {
        console.error('Erreur désinscription admin:', err);
        return res.status(500).json({ error: 'Erreur lors de la désinscription' });
    }
});

// Faire passer un membre de la liste d'attente aux inscrits (ADMIN)
app.put('/api/admin/seances/:seanceId/inscriptions/:userId/promote', requireAdmin, async (req, res) => {
    try {
        const seance = await seanceDeLaRoute(req, res);
        if (!seance) return;

        const inscription = await db.get(
            `SELECT id FROM inscriptions WHERE seance_id = ? AND user_id = ? AND statut = 'attente'`,
            [seance.id, req.params.userId]
        );
        if (!inscription) {
            return res.status(404).json({ error: 'Utilisateur non trouvé en liste d\'attente' });
        }

        await db.run(`UPDATE inscriptions SET statut = 'inscrit', position_attente = NULL WHERE id = ?`, [inscription.id]);
        await seances.renumeroterAttente(db, seance.id);

        console.log('Promotion admin réussie:', { userId: req.params.userId, seanceId: seance.id });
        res.json({ message: 'Utilisateur promu avec succès' });
    } catch (err) {
        console.error('Erreur promotion admin:', err);
        return res.status(500).json({ error: 'Erreur lors de la promotion' });
    }
});

// Inscription d'un membre à une séance : { seanceId }, ou { creneauId,
// date_seance } pour les pages ouvertes avant la mise à jour
app.post('/api/inscriptions', requireAuth, async (req, res) => {
    const { seanceId, creneauId, date_seance } = req.body;
    const userId = req.session.userId;

    console.log('Tentative d\'inscription:', { userId, seanceId, creneauId, date_seance });

    if (!seanceId && !(creneauId && date_seance)) {
        return res.status(400).json({ error: 'Séance requise' });
    }

    try {
        const seance = await seances.resoudreSeance(db, req.body);
        if (!seance) {
            return res.status(404).json({ error: 'Séance non trouvée' });
        }

        // Seules les séances à venir des semaines ouvertes aux membres se réservent
        const finFenetre = seances.ajouterJours(seances.lundiDeLaSemaine(seances.SEMAINES_MEMBRES), -1);
        if (seance.annulee) {
            return res.status(400).json({ error: 'Cette séance est annulée' });
        }
        if (seance.date_seance < seances.aujourdhuiIso()) {
            return res.status(400).json({ error: 'Cette séance est terminée' });
        }
        if (seance.date_seance > finFenetre) {
            return res.status(400).json({ error: 'Les inscriptions à cette séance ne sont pas encore ouvertes' });
        }

        const existingInscription = await db.get(
            `SELECT id FROM inscriptions WHERE user_id = ? AND seance_id = ?`,
            [userId, seance.id]
        );
        if (existingInscription) {
            return res.status(400).json({ error: 'Vous êtes déjà inscrit à ce créneau pour cette date' });
        }

        // Quota hebdomadaire : seulement si le sport de la séance en a un de configuré
        const limitesBrutes = await verifierLimitesSeances(db, userId, seance.sport_id, seance.date_seance);
        const limites = limitesBrutes.limiteApplicable ? limitesBrutes : null;
        const libelleSport = seance.sport_nom ? ` de ${seance.sport_nom.toLowerCase()}` : '';

        if (limites && limites.limiteAtteinte) {
            return res.status(400).json({
                error: `Vous avez atteint votre limite de ${limites.maxSeances} séances${libelleSport} par semaine (${limites.seancesActuelles}/${limites.maxSeances})`
            });
        }

        // Règle de bloc : une séance par bloc dans la semaine
        const regleBloc = await verifierRegleBloc(db, userId, seance);
        if (!regleBloc.autorise) {
            return res.status(400).json({ error: regleBloc.message });
        }

        const inscritActuels = await seances.compterInscrits(db, seance.id);

        let statut = 'inscrit';
        let positionAttente = null;
        // Le décompte restant n'a de sens que pour un sport soumis au quota
        let message = limites
            ? `Inscription réussie au créneau "${seance.nom}" ! Il vous reste ${limites.seancesRestantes - 1} séance(s)${libelleSport} cette semaine.`
            : `Inscription réussie au créneau "${seance.nom}" !`;

        // Une séance sans limite (sortie extérieure) n'est jamais complète :
        // pas de liste d'attente, tout le monde est inscrit.
        if (!seance.sans_limite && inscritActuels >= seance.capacite_max) {
            statut = 'attente';
            positionAttente = await seances.prochainePositionAttente(db, seance.id);
            message = `Créneau complet ! Vous avez été ajouté à la liste d'attente (position ${positionAttente}).`;
        }

        const result = await db.run(
            db.adaptSQL(
                `INSERT INTO inscriptions (user_id, creneau_id, seance_id, date_seance, statut, position_attente) VALUES (?, ?, ?, ?, ?, ?)`,
                `INSERT INTO inscriptions (user_id, creneau_id, seance_id, date_seance, statut, position_attente) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`
            ),
            [userId, seance.creneau_id, seance.id, seance.date_seance, statut, positionAttente]
        );

        console.log('Inscription réussie:', { userId, seanceId: seance.id, statut, positionAttente, inscritActuels, capaciteMax: seance.capacite_max });

        res.json({
            message,
            statut,
            positionAttente,
            inscriptionId: result.lastID || result.id,
            seancesRestantes: limites
                ? (statut === 'inscrit' ? limites.seancesRestantes - 1 : limites.seancesRestantes)
                : null
        });
    } catch (err) {
        // Double clic : la contrainte d'unicité a devancé la vérification
        if (err.message && (err.message.includes('UNIQUE constraint failed') || err.message.includes('duplicate key'))) {
            return res.status(400).json({ error: 'Vous êtes déjà inscrit à ce créneau pour cette date' });
        }
        console.error('Erreur inscription:', err);
        return res.status(500).json({ error: 'Erreur lors de l\'inscription' });
    }
});
// Jeton de liste d'attente encore valable, avec son membre et sa séance
const jetonAttenteValide = async (token) => {
    const jeton = await db.get(
        `SELECT wt.*, u.email, u.nom, u.prenom
         FROM waitlist_tokens wt
         JOIN users u ON wt.user_id = u.id
         WHERE wt.token = ? AND wt.used = ? AND wt.expires_at > ?`,
        [token, false, new Date().toISOString()]
    );
    if (!jeton || !jeton.seance_id) return null;

    const seance = await seances.trouverSeance(db, jeton.seance_id);
    return seance && !seance.annulee ? { jeton, seance } : null;
};

// Route pour obtenir les infos du token (pour affichage)
app.get('/api/inscription-attente/info/:token', async (req, res) => {
    try {
        const valide = await jetonAttenteValide(req.params.token);

        if (!valide) {
            return res.status(400).json({ error: 'Token invalide ou expiré' });
        }

        const { jeton, seance } = valide;
        const jour = dateLisible(seance.date_seance);

        res.json({
            user: `${jeton.prenom} ${jeton.nom}`,
            email: jeton.email,
            creneau: seance.nom,
            jour: jour.charAt(0).toUpperCase() + jour.slice(1),
            horaire: `${seance.heure_debut} - ${seance.heure_fin}`,
            date_seance: seance.date_seance
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
        const valide = await jetonAttenteValide(token);

        if (!valide) {
            return res.status(400).json({ error: 'Token invalide ou expiré' });
        }

        const { jeton, seance } = valide;

        const enAttente = await db.get(
            `SELECT id FROM inscriptions WHERE user_id = ? AND seance_id = ? AND statut = 'attente'`,
            [jeton.user_id, seance.id]
        );

        if (!enAttente) {
            return res.status(400).json({ error: 'Vous n\'êtes plus en liste d\'attente pour ce créneau' });
        }

        // Vérification en temps réel : le premier à confirmer prend la place
        if (!seance.sans_limite && await seances.compterInscrits(db, seance.id) >= seance.capacite_max) {
            return res.status(409).json({
                error: 'Désolé, quelqu\'un d\'autre a pris la place avant vous ! Le créneau est à nouveau complet.',
                tooLate: true
            });
        }

        await db.run(`UPDATE inscriptions SET statut = 'inscrit', position_attente = NULL WHERE id = ?`, [enAttente.id]);
        await seances.renumeroterAttente(db, seance.id);

        // Ce jeton est consommé ; ceux des autres membres pour cette séance n'ont plus d'objet
        await db.run(`UPDATE waitlist_tokens SET used = ? WHERE token = ?`, [true, token]);
        await db.run(`UPDATE waitlist_tokens SET used = ? WHERE seance_id = ? AND token != ?`, [true, seance.id, token]);

        console.log(`✅ Inscription via token réussie: ${jeton.email} -> ${seance.nom} (${seance.date_seance})`);

        res.json({
            message: `Inscription confirmée pour le créneau "${seance.nom}" !`,
            success: true,
            creneau: seance.nom
        });
    } catch (err) {
        console.error('Erreur inscription via token:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Désinscription d'un membre. Le départ d'un inscrit libère une place :
// la liste d'attente est alors prévenue par email.
const desinscrire = async (req, res, seance) => {
    const userId = req.session.userId;
    const retrait = seance ? await seances.retirerInscription(db, seance.id, userId) : null;

    if (!retrait) {
        return res.status(404).json({ error: 'Inscription non trouvée' });
    }

    console.log('Désinscription réussie:', { userId, seanceId: seance.id });

    if (retrait.placeLiberee && seanceAVenir(seance)) {
        const emailsEnvoyes = await notifierListeAttente(seance);
        if (emailsEnvoyes > 0) {
            return res.json({
                message: `Désinscription réussie. ${emailsEnvoyes} personne(s) en liste d'attente ont été notifiées par email.`,
                notification: true,
                emailsEnvoyes
            });
        }
    }

    res.json({ message: 'Désinscription réussie' });
};

app.delete('/api/seances/:seanceId/inscription', requireAuth, async (req, res) => {
    try {
        await desinscrire(req, res, await seances.trouverSeance(db, req.params.seanceId));
    } catch (err) {
        console.error('Erreur désinscription:', err);
        return res.status(500).json({ error: 'Erreur lors de la désinscription' });
    }
});

// Ancienne forme (créneau + date), pour les pages ouvertes avant la mise à jour
app.delete('/api/inscriptions/:creneauId', requireAuth, async (req, res) => {
    const { date_seance } = req.body || {};

    if (!date_seance) {
        return res.status(400).json({ error: 'La date de séance est requise' });
    }

    try {
        await desinscrire(req, res, await seances.trouverSeanceParCreneau(db, req.params.creneauId, date_seance));
    } catch (err) {
        console.error('Erreur désinscription:', err);
        return res.status(500).json({ error: 'Erreur lors de la désinscription' });
    }
});
// Routes d'administration des limites de licence
app.get('/api/admin/licence-limits', requireAdmin, async (req, res) => {
    try {
        const rows = await db.query(
            db.adaptSQL(
                `SELECT ll.*, s.nom as sport_nom, s.icone as sport_icone
                 FROM licence_limits ll LEFT JOIN sports s ON ll.sport_id = s.id
                 ORDER BY s.ordre, ll.licence_type`,
                `SELECT ll.*, s.nom as sport_nom, s.icone as sport_icone
                 FROM licence_limits ll LEFT JOIN sports s ON ll.sport_id = s.id
                 ORDER BY s.ordre, ll.licence_type`
            ),
            []
        );
        res.json(rows);
    } catch (err) {
        console.error('Erreur récupération limites:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération des limites' });
    }
});

app.put('/api/admin/licence-limits/:licenceType', requireAdmin, async (req, res) => {
    const licenceType = req.params.licenceType;
    const { max_seances_semaine, sport_id } = req.body;

    console.log('Modification limite licence:', licenceType, 'vers', max_seances_semaine);

    if (!max_seances_semaine || max_seances_semaine < 1 || max_seances_semaine > 10) {
        return res.status(400).json({ error: 'Le nombre de séances doit être entre 1 et 10' });
    }

    try {
        // Une limite porte sur un couple (licence, sport). Sans sport précisé,
        // on met à jour toutes les limites de cette licence.
        const result = sport_id
            ? await db.run(
                db.adaptSQL(
                    `UPDATE licence_limits SET max_seances_semaine = ? WHERE licence_type = ? AND sport_id = ?`,
                    `UPDATE licence_limits SET max_seances_semaine = $1 WHERE licence_type = $2 AND sport_id = $3`
                ),
                [max_seances_semaine, licenceType, sport_id]
            )
            : await db.run(
                db.adaptSQL(
                    `UPDATE licence_limits SET max_seances_semaine = ? WHERE licence_type = ?`,
                    `UPDATE licence_limits SET max_seances_semaine = $1 WHERE licence_type = $2`
                ),
                [max_seances_semaine, licenceType]
            );

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
    // Sans sport précisé, la remise à zéro porte sur toutes les disciplines
    const { sport_id } = req.body || {};

    console.log('🔄 Début de la remise à zéro hebdomadaire par admin:', req.session.userId, sport_id ? `(sport ${sport_id})` : '(tous sports)');

    try {
        let sportNom = null;
        if (sport_id) {
            const sport = await db.get(
                db.adaptSQL(`SELECT nom FROM sports WHERE id = ?`, `SELECT nom FROM sports WHERE id = $1`),
                [sport_id]
            );
            if (!sport) {
                return res.status(404).json({ error: 'Sport non trouvé' });
            }
            sportNom = sport.nom;
        }

        // Seules la semaine en cours et les précédentes sont vidées : les
        // réservations des semaines à venir sont conservées
        const finSemaine = seances.ajouterJours(seances.lundiDeLaSemaine(0), 6);
        const filtreSport = ` WHERE seance_id IN (SELECT id FROM seances WHERE date_seance <= ?${sport_id ? ' AND sport_id = ?' : ''})`;
        const params = sport_id ? [finSemaine, sport_id] : [finSemaine];

        const countResult = await db.get(`SELECT COUNT(*) as total FROM inscriptions${filtreSport}`, params);
        const inscriptionsAvant = countResult.total || 0;

        console.log(`📊 Inscriptions à supprimer: ${inscriptionsAvant}`);

        await db.run(`DELETE FROM inscriptions${filtreSport}`, params);

        const verificationResult = await db.get(`SELECT COUNT(*) as total FROM inscriptions${filtreSport}`, params);
        const inscriptionsApres = verificationResult.total || 0;

        console.log(`✅ Remise à zéro terminée: ${inscriptionsAvant} inscription(s) supprimée(s), ${inscriptionsApres} restante(s)`);

        // Log de sécurité
        console.log(`🔒 Remise à zéro hebdomadaire (${sportNom || 'tous sports'}) effectuée par l'admin ${req.session.userId} le ${new Date().toISOString()}`);

        res.json({
            message: sportNom
                ? `Remise à zéro réussie pour ${sportNom} : ${inscriptionsAvant} inscription(s) supprimée(s)`
                : `Remise à zéro hebdomadaire réussie : ${inscriptionsAvant} inscription(s) supprimée(s)`,
            sport: sportNom,
            inscriptionsSupprimes: inscriptionsAvant,
            inscriptionsRestantes: inscriptionsApres
        });
    } catch (err) {
        console.error('❌ Erreur lors de la remise à zéro hebdomadaire:', err);
        return res.status(500).json({ error: 'Erreur lors de la remise à zéro hebdomadaire' });
    }
});

