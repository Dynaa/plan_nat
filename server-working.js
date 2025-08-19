require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
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
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 heures
    }
};

// En production, ajouter des options de sécurité supplémentaires
if (process.env.NODE_ENV === 'production') {
    sessionConfig.cookie.httpOnly = true;
    sessionConfig.cookie.sameSite = 'strict';
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

// Base de données SQLite simple
const dbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH ? 
    `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/natation.db` : './natation.db';
console.log('📁 Base de données SQLite:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Erreur de connexion à la base de données:', err.message);
    } else {
        console.log('✅ Connexion à la base de données réussie');
    }
});

// Initialisation de la base de données
console.log('🔄 Initialisation de la base de données...');
db.serialize(() => {
    // Table des utilisateurs
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        nom TEXT NOT NULL,
        prenom TEXT NOT NULL,
        role TEXT DEFAULT 'membre',
        licence_type TEXT DEFAULT 'Loisir/Senior',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Table des créneaux
    db.run(`CREATE TABLE IF NOT EXISTS creneaux (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT NOT NULL,
        jour_semaine INTEGER NOT NULL,
        heure_debut TEXT NOT NULL,
        heure_fin TEXT NOT NULL,
        capacite_max INTEGER NOT NULL,
        licences_autorisees TEXT DEFAULT 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles',
        actif BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Table des inscriptions
    db.run(`CREATE TABLE IF NOT EXISTS inscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        creneau_id INTEGER NOT NULL,
        statut TEXT DEFAULT 'inscrit',
        position_attente INTEGER NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        FOREIGN KEY (creneau_id) REFERENCES creneaux (id),
        UNIQUE(user_id, creneau_id)
    )`);

    // Table des limites de séances
    db.run(`CREATE TABLE IF NOT EXISTS licence_limits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        licence_type TEXT UNIQUE NOT NULL,
        max_seances_semaine INTEGER NOT NULL DEFAULT 3,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Créer admin par défaut
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@triathlon.com';
    const adminPassword = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);
    
    db.run(`INSERT OR IGNORE INTO users (email, password, nom, prenom, role) 
            VALUES (?, ?, 'Admin', 'Système', 'admin')`, 
            [adminEmail, adminPassword]);

    // Créer utilisateur de test (seulement en développement)
    if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
        const userPassword = bcrypt.hashSync('test123', 10);
        db.run(`INSERT OR IGNORE INTO users (email, password, nom, prenom, licence_type) 
                VALUES (?, ?, 'Dupont', 'Jean', 'Loisir/Senior')`, 
                ['test@triathlon.com', userPassword]);
    }

    // Créer créneaux de test
    db.get(`SELECT COUNT(*) as count FROM creneaux`, [], (err, result) => {
        if (!err && result.count === 0) {
            console.log('Création des créneaux de test...');
            const creneauxTest = [
                ['Natation Débutants', 1, '18:00', '19:00', 8, 'Loisir/Senior'],
                ['Natation Confirmés', 1, '19:00', '20:00', 6, 'Compétition,Loisir/Senior'],
                ['École de Natation', 3, '12:00', '13:00', 10, 'Poussins/Pupilles,Benjamins/Junior'],
                ['Entraînement Compétition', 5, '18:30', '19:30', 12, 'Compétition'],
                ['Natation Libre', 6, '10:00', '11:00', 15, 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles']
            ];
            
            creneauxTest.forEach(([nom, jour, debut, fin, capacite, licences]) => {
                db.run(`INSERT INTO creneaux (nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees) 
                        VALUES (?, ?, ?, ?, ?, ?)`, [nom, jour, debut, fin, capacite, licences]);
            });
        }
    });

    // Créer limites par défaut
    db.get(`SELECT COUNT(*) as count FROM licence_limits`, [], (err, result) => {
        if (!err && result.count === 0) {
            const limitesParDefaut = [
                ['Compétition', 6],
                ['Loisir/Senior', 3],
                ['Benjamins/Junior', 4],
                ['Poussins/Pupilles', 2]
            ];

            limitesParDefaut.forEach(([licenceType, maxSeances]) => {
                db.run(`INSERT INTO licence_limits (licence_type, max_seances_semaine) VALUES (?, ?)`,
                    [licenceType, maxSeances]);
            });
        }
    });
});

console.log('✅ Base de données initialisée');// 
Fonctions d'envoi d'email (simplifiées)
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
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Non authentifié' });
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.userId || req.session.userRole !== 'admin') {
        return res.status(403).json({ error: 'Accès administrateur requis' });
    }
    next();
};

// Routes d'authentification
app.post('/api/register', (req, res) => {
    const { email, password, nom, prenom, licence_type } = req.body;
    
    if (!email || !password || !nom || !prenom || !licence_type) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    const licencesValides = ['Compétition', 'Loisir/Senior', 'Benjamins/Junior', 'Poussins/Pupilles'];
    if (!licencesValides.includes(licence_type)) {
        return res.status(400).json({ error: 'Type de licence invalide' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    
    db.run(`INSERT INTO users (email, password, nom, prenom, licence_type) VALUES (?, ?, ?, ?, ?)`,
        [email, hashedPassword, nom, prenom, licence_type], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Email déjà utilisé' });
                }
                return res.status(500).json({ error: 'Erreur lors de la création du compte' });
            }
            res.json({ message: 'Compte créé avec succès', userId: this.lastID });
        });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    console.log('Tentative de connexion pour:', email);
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email et mot de passe requis' });
    }
    
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
        if (err) {
            console.error('Erreur base de données:', err);
            return res.status(500).json({ error: 'Erreur de base de données' });
        }
        
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
    });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Déconnexion réussie' });
});

app.get('/api/auth-status', (req, res) => {
    if (req.session.userId) {
        db.get(`SELECT id, nom, prenom, role, licence_type FROM users WHERE id = ?`, 
            [req.session.userId], (err, user) => {
                if (err || !user) {
                    return res.status(401).json({ authenticated: false });
                }
                res.json({ 
                    authenticated: true, 
                    user: { id: user.id, nom: user.nom, prenom: user.prenom, role: user.role, licence_type: user.licence_type }
                });
            });
    } else {
        res.json({ authenticated: false });
    }
});

// Routes des créneaux
app.get('/api/creneaux', (req, res) => {
    const query = `
        SELECT c.*, 
               COUNT(CASE WHEN i.statut = 'inscrit' THEN 1 END) as inscrits,
               COUNT(CASE WHEN i.statut = 'attente' THEN 1 END) as en_attente
        FROM creneaux c
        LEFT JOIN inscriptions i ON c.id = i.creneau_id
        WHERE c.actif = 1
        GROUP BY c.id
        ORDER BY c.jour_semaine, c.heure_debut
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Erreur récupération créneaux:', err);
            return res.status(500).json({ error: 'Erreur lors de la récupération des créneaux' });
        }
        res.json(rows);
    });
});

app.get('/api/creneaux/:creneauId', (req, res) => {
    const creneauId = req.params.creneauId;
    
    db.get(`SELECT * FROM creneaux WHERE id = ?`, [creneauId], (err, creneau) => {
        if (err) {
            console.error('Erreur récupération créneau:', err);
            return res.status(500).json({ error: 'Erreur lors de la récupération du créneau' });
        }
        
        if (!creneau) {
            return res.status(404).json({ error: 'Créneau non trouvé' });
        }
        
        res.json(creneau);
    });
});

// Route pour les inscriptions de l'utilisateur
app.get('/api/mes-inscriptions', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    const query = `
        SELECT i.*, c.nom, c.jour_semaine, c.heure_debut, c.heure_fin
        FROM inscriptions i
        JOIN creneaux c ON i.creneau_id = c.id
        WHERE i.user_id = ?
        ORDER BY c.jour_semaine, c.heure_debut
    `;
    
    console.log('Requête mes-inscriptions pour userId:', userId);
    
    db.all(query, [userId], (err, rows) => {
        if (err) {
            console.error('Erreur SQL mes-inscriptions:', err.message);
            return res.status(500).json({ 
                error: 'Erreur lors de la récupération des inscriptions'
            });
        }
        console.log('Inscriptions trouvées:', rows.length);
        res.json(rows);
    });
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