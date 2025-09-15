require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const DatabaseAdapter = require('./database');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

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
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER || 'ethereal.user@ethereal.email',
        pass: process.env.SMTP_PASS || 'ethereal.pass'
    }
};

// Créer le transporteur email
let transporter;
const initEmailTransporter = async () => {
    try {
        // En production, désactiver les emails si pas de configuration SMTP complète
        if (process.env.NODE_ENV === 'production' && (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS)) {
            console.log('📧 Mode production : emails désactivés (pas de configuration SMTP)');
            transporter = null;
            return;
        }
        
        if (!process.env.SMTP_HOST) {
            const testAccount = await nodemailer.createTestAccount();
            emailConfig.auth.user = testAccount.user;
            emailConfig.auth.pass = testAccount.pass;
            console.log('=== Configuration Email de Test ===');
            console.log('User:', testAccount.user);
            console.log('Pass:', testAccount.pass);
            console.log('Prévisualisez les emails sur: https://ethereal.email');
            console.log('===================================');
        }

        transporter = nodemailer.createTransport(emailConfig);
        await transporter.verify();
        console.log('✅ Serveur email configuré avec succès');
    } catch (error) {
        console.error('❌ Erreur configuration email:', error.message);
        console.log('📧 Les notifications email seront désactivées');
        transporter = null;
    }
};

// Initialiser le transporteur email
initEmailTransporter();

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
        console.log('🔧 Initialisation de la base de données...');
        
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
        await db.run(usersSQL);

        // Table des créneaux
        const creneauxSQL = db.adaptSQL(
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
        await db.run(creneauxSQL);

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
        await db.run(inscriptionsSQL);

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
        await db.run(limitsSQL);

        // Table de configuration des méta-règles
        const metaConfigSQL = db.adaptSQL(
            // SQLite
            `CREATE TABLE IF NOT EXISTS meta_rules_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                enabled BOOLEAN DEFAULT FALSE,
                description TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_by INTEGER,
                FOREIGN KEY (updated_by) REFERENCES users(id)
            )`,
            // PostgreSQL
            `CREATE TABLE IF NOT EXISTS meta_rules_config (
                id SERIAL PRIMARY KEY,
                enabled BOOLEAN DEFAULT false,
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_by INTEGER,
                FOREIGN KEY (updated_by) REFERENCES users(id)
            )`
        );
        await db.run(metaConfigSQL);

        // Table des méta-règles par licence
        const metaRulesSQL = db.adaptSQL(
            // SQLite
            `CREATE TABLE IF NOT EXISTS meta_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                licence_type TEXT NOT NULL,
                jour_source INTEGER NOT NULL,
                jours_interdits TEXT NOT NULL,
                description TEXT,
                active BOOLEAN DEFAULT TRUE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER,
                FOREIGN KEY (created_by) REFERENCES users(id)
            )`,
            // PostgreSQL
            `CREATE TABLE IF NOT EXISTS meta_rules (
                id SERIAL PRIMARY KEY,
                licence_type VARCHAR(100) NOT NULL,
                jour_source INTEGER NOT NULL,
                jours_interdits TEXT NOT NULL,
                description TEXT,
                active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER,
                FOREIGN KEY (created_by) REFERENCES users(id)
            )`
        );
        await db.run(metaRulesSQL);

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
            const creneauxTest = [
                ['Natation Débutants', 1, '18:00', '19:00', 8, 'Loisir/Senior'],
                ['Natation Confirmés', 1, '19:00', '20:00', 6, 'Compétition,Loisir/Senior'],
                ['École de Natation', 3, '12:00', '13:00', 10, 'Poussins/Pupilles,Benjamins/Junior'],
                ['Entraînement Compétition', 5, '18:30', '19:30', 12, 'Compétition'],
                ['Natation Libre', 6, '10:00', '11:00', 15, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles']
            ];
            
            for (const [nom, jour, debut, fin, capacite, licences] of creneauxTest) {
                await db.run(`INSERT INTO creneaux (nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees) VALUES (?, ?, ?, ?, ?, ?)`, 
                    [nom, jour, debut, fin, capacite, licences]);
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

        // Initialiser la configuration des méta-règles
        const configCount = await db.get(`SELECT COUNT(*) as count FROM meta_rules_config`);
        if (!configCount || configCount.count === 0) {
            await db.run(`INSERT INTO meta_rules_config (enabled, description) VALUES (?, ?)`,
                [false, 'Configuration des méta-règles d\'inscription par licence']);
        }

        console.log('✅ Base de données initialisée avec succès');
    } catch (err) {
        console.error('❌ Erreur initialisation base de données:', err);
        throw err;
    }
}

// Initialisation de la base de données (SQLite ou PostgreSQL)
const db = new DatabaseAdapter();
const initPostgres = require('./init-postgres');

// Initialisation de la base de données
console.log('🔄 Initialisation de la base de données...');

// Si PostgreSQL, utiliser le script d'initialisation dédié
if (db.isPostgres) {
    initPostgres().then(() => {
        console.log('✅ Base de données PostgreSQL initialisée');
    }).catch(err => {
        console.error('❌ Erreur initialisation PostgreSQL:', err);
    });
} else {
    // Initialisation avec l'adaptateur unifié
    initializeDatabase().then(() => {
        console.log('✅ Base de données SQLite initialisée');
    }).catch(err => {
        console.error('❌ Erreur initialisation SQLite:', err);
    });
}
}

// Fonctions d'envoi d'email (simplifiées)
const sendEmail = async (to, subject, htmlContent) => {
    if (!transporter) {
        console.log('📧 Email non envoyé (transporteur non configuré):', subject);
        return false;
    }
    
    try {
        const info = await transporter.sendMail({
            from: '"Club Triathlon 🏊‍♂️" <noreply@triathlon.com>',
            to: to,
            subject: subject,
            html: htmlContent
        });
        
        console.log('📧 Email envoyé:', subject, 'à', to);
        return true;
    } catch (error) {
        console.error('❌ Erreur envoi email:', error.message);
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
    const query = `
        SELECT c.*, 
               COUNT(CASE WHEN i.statut = 'inscrit' THEN 1 END) as inscrits,
               COUNT(CASE WHEN i.statut = 'attente' THEN 1 END) as en_attente
        FROM creneaux c
        LEFT JOIN inscriptions i ON c.id = i.creneau_id
        WHERE c.actif = ${db.isPostgres ? 'true' : '1'}
        GROUP BY c.id
        ORDER BY c.jour_semaine, c.heure_debut
    `;
    
    try {
        const rows = await db.query(query, []);
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

// Gestion des erreurs non capturées
process.on('uncaughtException', (error) => {
    console.error('❌ Erreur non capturée:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesse rejetée non gérée:', reason);
});

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

// Routes de création de créneaux (ADMIN)
app.post('/api/creneaux', requireAdmin, async (req, res) => {
    const { nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees } = req.body;
    
    try {
        const sql = db.isPostgres ? 
            `INSERT INTO creneaux (nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id` :
            `INSERT INTO creneaux (nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees) 
             VALUES (?, ?, ?, ?, ?, ?)`;
        
        const result = await db.run(sql, [
            nom, 
            jour_semaine, 
            heure_debut, 
            heure_fin, 
            capacite_max, 
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

// Route de modification de créneaux (ADMIN) - Version simplifiée
app.put('/api/creneaux/:creneauId', requireAdmin, async (req, res) => {
    const creneauId = req.params.creneauId;
    const { nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees } = req.body;
    
    console.log('Modification du créneau:', creneauId, req.body);
    
    if (!nom || jour_semaine === undefined || !heure_debut || !heure_fin || !capacite_max) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
    }
    
    try {
        // Mise à jour simplifiée (sans gestion avancée des capacités pour l'instant)
        const sql = db.isPostgres ?
            `UPDATE creneaux SET nom = $1, jour_semaine = $2, heure_debut = $3, heure_fin = $4, capacite_max = $5, licences_autorisees = $6 WHERE id = $7` :
            `UPDATE creneaux SET nom = ?, jour_semaine = ?, heure_debut = ?, heure_fin = ?, capacite_max = ?, licences_autorisees = ? WHERE id = ?`;
        
        const result = await db.run(sql, [
            nom, 
            jour_semaine, 
            heure_debut, 
            heure_fin, 
            capacite_max, 
            licences_autorisees || 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles',
            creneauId
        ]);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Créneau non trouvé' });
        }
        
        console.log('Créneau modifié avec succès:', creneauId);
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

// Fonction pour vérifier les limites de séances par semaine
const verifierLimitesSeances = async (userId) => {
    // Calculer le début et la fin de la semaine courante (lundi à dimanche)
    const maintenant = new Date();
    const jourSemaine = maintenant.getDay(); // 0 = dimanche, 1 = lundi, etc.
    const joursDepuisLundi = jourSemaine === 0 ? 6 : jourSemaine - 1; // Ajuster pour que lundi = 0
    
    const debutSemaine = new Date(maintenant);
    debutSemaine.setDate(maintenant.getDate() - joursDepuisLundi);
    debutSemaine.setHours(0, 0, 0, 0);
    
    const finSemaine = new Date(debutSemaine);
    finSemaine.setDate(debutSemaine.getDate() + 6);
    finSemaine.setHours(23, 59, 59, 999);

    const query = db.isPostgres ? `
        SELECT 
            u.licence_type,
            ll.max_seances_semaine,
            COUNT(i.id) as seances_cette_semaine
        FROM users u
        LEFT JOIN licence_limits ll ON u.licence_type = ll.licence_type
        LEFT JOIN inscriptions i ON u.id = i.user_id 
            AND i.statut = 'inscrit'
            AND i.created_at >= $1 
            AND i.created_at <= $2
        WHERE u.id = $3
        GROUP BY u.id, u.licence_type, ll.max_seances_semaine
    ` : `
        SELECT 
            u.licence_type,
            ll.max_seances_semaine,
            COUNT(i.id) as seances_cette_semaine
        FROM users u
        LEFT JOIN licence_limits ll ON u.licence_type = ll.licence_type
        LEFT JOIN inscriptions i ON u.id = i.user_id 
            AND i.statut = 'inscrit'
            AND i.created_at >= ? 
            AND i.created_at <= ?
        WHERE u.id = ?
        GROUP BY u.id, u.licence_type, ll.max_seances_semaine
    `;

    try {
        const result = await db.get(query, [debutSemaine.toISOString(), finSemaine.toISOString(), userId]);

        if (!result) {
            throw new Error('Utilisateur non trouvé');
        }

        const limiteAtteinte = result.seances_cette_semaine >= (result.max_seances_semaine || 3);
        
        return {
            licenceType: result.licence_type,
            maxSeances: result.max_seances_semaine || 3,
            seancesActuelles: parseInt(result.seances_cette_semaine) || 0,
            limiteAtteinte: limiteAtteinte,
            seancesRestantes: Math.max(0, (result.max_seances_semaine || 3) - (parseInt(result.seances_cette_semaine) || 0))
        };
    } catch (err) {
        console.error('Erreur lors de la vérification des limites:', err);
        throw err;
    }
};

// Fonction pour vérifier les méta-règles d'inscription
const verifierMetaRegles = async (userId, creneauId) => {
    try {
        // Vérifier si les méta-règles sont activées
        const config = await db.get(`SELECT enabled FROM meta_rules_config ORDER BY id DESC LIMIT 1`);
        
        if (!config || !config.enabled) {
            return { autorise: true, message: null };
        }

        // Récupérer les informations de l'utilisateur et du créneau
        const userInfo = await db.get(`SELECT licence_type FROM users WHERE id = ?`, [userId]);
        const creneauInfo = await db.get(`SELECT jour_semaine FROM creneaux WHERE id = ?`, [creneauId]);
        
        if (!userInfo || !creneauInfo) {
            return { autorise: false, message: 'Informations utilisateur ou créneau introuvables' };
        }

        // Récupérer les méta-règles actives pour ce type de licence
        const metaRegles = await db.query(`
            SELECT jour_source, jours_interdits, description 
            FROM meta_rules 
            WHERE licence_type = ? AND active = true
        `, [userInfo.licence_type]);

        if (!metaRegles || metaRegles.length === 0) {
            return { autorise: true, message: null };
        }

        // Calculer le début et la fin de la semaine courante
        const maintenant = new Date();
        const jourSemaine = maintenant.getDay();
        const joursDepuisLundi = jourSemaine === 0 ? 6 : jourSemaine - 1;
        
        const debutSemaine = new Date(maintenant);
        debutSemaine.setDate(maintenant.getDate() - joursDepuisLundi);
        debutSemaine.setHours(0, 0, 0, 0);
        
        const finSemaine = new Date(debutSemaine);
        finSemaine.setDate(debutSemaine.getDate() + 6);
        finSemaine.setHours(23, 59, 59, 999);

        // Vérifier chaque méta-règle
        for (const regle of metaRegles) {
            console.log('🔍 Vérification méta-règle:', {
                licenceType: userInfo.licence_type,
                jourSource: regle.jour_source,
                jourCreneau: creneauInfo.jour_semaine,
                joursInterdits: regle.jours_interdits
            });

            // Vérifier si l'utilisateur est inscrit au jour source cette semaine
            const inscriptionSource = await db.get(`
                SELECT i.id 
                FROM inscriptions i
                JOIN creneaux c ON i.creneau_id = c.id
                WHERE i.user_id = ? 
                AND c.jour_semaine = ? 
                AND i.statut = 'inscrit'
                AND i.created_at >= ? 
                AND i.created_at <= ?
            `, [userId, regle.jour_source, debutSemaine.toISOString(), finSemaine.toISOString()]);

            console.log('📅 Inscription au jour source trouvée:', !!inscriptionSource);

            if (inscriptionSource) {
                // L'utilisateur est inscrit au jour source, vérifier les jours interdits
                console.log('🔍 Données brutes jours_interdits:', regle.jours_interdits, typeof regle.jours_interdits);
                
                let joursInterdits;
                try {
                    // Essayer de parser comme JSON d'abord
                    joursInterdits = JSON.parse(regle.jours_interdits);
                } catch (e) {
                    // Si ça échoue, traiter comme une chaîne séparée par des virgules
                    console.log('⚠️ Parsing JSON échoué, traitement comme chaîne CSV');
                    joursInterdits = regle.jours_interdits.split(',').map(j => parseInt(j.trim()));
                }
                
                const jourCreneau = creneauInfo.jour_semaine;
                
                console.log('⚠️ Vérification interdiction:', {
                    jourCreneau,
                    joursInterdits,
                    estInterdit: joursInterdits.includes(jourCreneau)
                });
                
                if (joursInterdits.includes(jourCreneau)) {
                    const joursNoms = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
                    console.log('🚫 Inscription bloquée par méta-règle');
                    return {
                        autorise: false,
                        message: `Inscription interdite : vous êtes déjà inscrit le ${joursNoms[regle.jour_source]} cette semaine. ${regle.description || ''}`
                    };
                }
            }
        }

        return { autorise: true, message: null };
    } catch (err) {
        console.error('Erreur lors de la vérification des méta-règles:', err);
        return { autorise: false, message: 'Erreur lors de la vérification des règles d\'inscription' };
    }
};

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
        const limites = await verifierLimitesSeances(userId);
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
        const metaReglesCheck = await verifierMetaRegles(user.id, creneauId);
        
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
        const limites = await verifierLimitesSeances(userId);
        
        if (limites.limiteAtteinte) {
            return res.status(400).json({ 
                error: `Vous avez atteint votre limite de ${limites.maxSeances} séances par semaine (${limites.seancesActuelles}/${limites.maxSeances})` 
            });
        }

        // Vérifier les méta-règles d'inscription
        const metaReglesCheck = await verifierMetaRegles(userId, creneauId);
        
        if (!metaReglesCheck.autorise) {
            return res.status(400).json({ 
                error: metaReglesCheck.message 
            });
        }
        
        // Vérifier la capacité du créneau et les inscriptions actuelles
        const creneauSql = db.isPostgres ?
            `SELECT c.capacite_max, c.nom, COUNT(i.id) as inscrits_actuels
             FROM creneaux c
             LEFT JOIN inscriptions i ON c.id = i.creneau_id AND i.statut = 'inscrit'
             WHERE c.id = $1
             GROUP BY c.id, c.capacite_max, c.nom` :
            `SELECT c.capacite_max, c.nom, COUNT(i.id) as inscrits_actuels
             FROM creneaux c
             LEFT JOIN inscriptions i ON c.id = i.creneau_id AND i.statut = 'inscrit'
             WHERE c.id = ?
             GROUP BY c.id, c.capacite_max, c.nom`;
        
        const creneauInfo = await db.get(creneauSql, [creneauId]);
        
        if (!creneauInfo) {
            return res.status(404).json({ error: 'Créneau non trouvé' });
        }
        
        const inscritActuels = parseInt(creneauInfo.inscrits_actuels) || 0;
        const capaciteMax = creneauInfo.capacite_max;
        
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
        
        // Si c'était un inscrit (pas en attente), promouvoir le premier de la liste d'attente
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
                // Promouvoir le premier de la liste d'attente
                const promoteSql = db.isPostgres ?
                    `UPDATE inscriptions 
                     SET statut = 'inscrit', position_attente = NULL 
                     WHERE id = $1` :
                    `UPDATE inscriptions 
                     SET statut = 'inscrit', position_attente = NULL 
                     WHERE id = ?`;
                
                await db.run(promoteSql, [premierEnAttente.id]);
                
                // Réorganiser les positions d'attente
                const reorganiserSql = db.isPostgres ?
                    `UPDATE inscriptions 
                     SET position_attente = position_attente - 1 
                     WHERE creneau_id = $1 AND statut = 'attente' AND position_attente > $2` :
                    `UPDATE inscriptions 
                     SET position_attente = position_attente - 1 
                     WHERE creneau_id = ? AND statut = 'attente' AND position_attente > ?`;
                
                await db.run(reorganiserSql, [creneauId, premierEnAttente.position_attente]);
                
                console.log('Promotion automatique réussie pour:', premierEnAttente.user_id);
                res.json({ 
                    message: 'Désinscription réussie. Une personne a été promue de la liste d\'attente.',
                    promotion: true
                });
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