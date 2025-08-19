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
    // Initialisation SQLite (code existant)
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

    console.log('✅ Base de données SQLite initialisée');
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

// Routes de création de créneaux (ADMIN)
app.post('/api/creneaux', requireAdmin, (req, res) => {
    const { nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees } = req.body;
    
    db.run(`INSERT INTO creneaux (nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees) 
            VALUES (?, ?, ?, ?, ?, ?)`,
        [nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees || 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles'], 
        function(err) {
            if (err) {
                console.error('Erreur création créneau:', err);
                return res.status(500).json({ error: 'Erreur lors de la création du créneau' });
            }
            res.json({ message: 'Créneau créé avec succès', creneauId: this.lastID });
        });
});

// Route de modification de créneaux (ADMIN)
app.put('/api/creneaux/:creneauId', requireAdmin, (req, res) => {
    const creneauId = req.params.creneauId;
    const { nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees } = req.body;
    
    console.log('Modification du créneau:', creneauId, req.body);
    
    if (!nom || jour_semaine === undefined || !heure_debut || !heure_fin || !capacite_max) {
        return res.status(400).json({ error: 'Tous les champs sont requis' });
    }
    
    // Vérifier d'abord le nombre d'inscrits actuels
    db.get(`SELECT COUNT(*) as inscrits FROM inscriptions WHERE creneau_id = ? AND statut = 'inscrit'`,
        [creneauId], (err, result) => {
            if (err) {
                console.error('Erreur lors de la vérification des inscrits:', err);
                return res.status(500).json({ error: 'Erreur de base de données' });
            }
            
            const inscritActuels = result.inscrits;
            const nouvelleCapacite = parseInt(capacite_max);
            
            console.log(`Inscrits actuels: ${inscritActuels}, Nouvelle capacité: ${nouvelleCapacite}`);
            
            // Mettre à jour le créneau
            db.run(`UPDATE creneaux SET nom = ?, jour_semaine = ?, heure_debut = ?, heure_fin = ?, capacite_max = ?, licences_autorisees = ? 
                    WHERE id = ?`,
                [nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees || 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles', creneauId], 
                function(err) {
                    if (err) {
                        console.error('Erreur lors de la mise à jour:', err);
                        return res.status(500).json({ error: 'Erreur lors de la modification du créneau' });
                    }
                    
                    if (this.changes === 0) {
                        return res.status(404).json({ error: 'Créneau non trouvé' });
                    }
                    
                    // Si la nouvelle capacité est inférieure au nombre d'inscrits actuels
                    if (inscritActuels > nouvelleCapacite) {
                        const aMettreSurListeAttente = inscritActuels - nouvelleCapacite;
                        
                        console.log(`Mise sur liste d'attente de ${aMettreSurListeAttente} personne(s)`);
                        
                        // Récupérer les derniers inscrits pour les mettre en attente
                        db.all(`SELECT id FROM inscriptions 
                                WHERE creneau_id = ? AND statut = 'inscrit' 
                                ORDER BY created_at DESC 
                                LIMIT ?`,
                            [creneauId, aMettreSurListeAttente], (err, derniers) => {
                                if (err) {
                                    console.error('Erreur lors de la récupération des derniers inscrits:', err);
                                    return res.status(500).json({ error: 'Erreur lors de la gestion des inscriptions' });
                                }
                                
                                if (derniers.length > 0) {
                                    const ids = derniers.map(d => d.id);
                                    const placeholders = ids.map(() => '?').join(',');
                                    
                                    // Obtenir la position maximale actuelle sur la liste d'attente
                                    db.get(`SELECT COALESCE(MAX(position_attente), 0) as max_pos 
                                            FROM inscriptions 
                                            WHERE creneau_id = ? AND statut = 'attente'`,
                                        [creneauId], (err, maxResult) => {
                                            if (err) {
                                                console.error('Erreur lors de la récupération de la position max:', err);
                                                return res.status(500).json({ error: 'Erreur lors de la gestion des inscriptions' });
                                            }
                                            
                                            let startPos = maxResult.max_pos + 1;
                                            
                                            // Mettre à jour chaque inscription
                                            let completed = 0;
                                            ids.forEach((id, index) => {
                                                db.run(`UPDATE inscriptions 
                                                        SET statut = 'attente', position_attente = ?
                                                        WHERE id = ?`,
                                                    [startPos + index, id], (err) => {
                                                        completed++;
                                                        if (completed === ids.length) {
                                                            console.log('Créneau modifié avec succès, inscriptions ajustées');
                                                            res.json({ 
                                                                message: `Créneau modifié avec succès. ${aMettreSurListeAttente} personne(s) mise(s) sur liste d'attente.`,
                                                                ajustements: aMettreSurListeAttente
                                                            });
                                                        }
                                                    });
                                            });
                                        });
                                } else {
                                    res.json({ message: 'Créneau modifié avec succès' });
                                }
                            });
                    } else {
                        res.json({ message: 'Créneau modifié avec succès' });
                    }
                });
        });
});

// Route de suppression de créneaux (ADMIN)
app.delete('/api/creneaux/:creneauId', requireAdmin, (req, res) => {
    const creneauId = req.params.creneauId;
    
    console.log('Tentative de suppression du créneau:', creneauId);
    
    // Vérifier d'abord s'il y a des inscriptions
    db.get(`SELECT COUNT(*) as count FROM inscriptions WHERE creneau_id = ?`, 
        [creneauId], (err, result) => {
            if (err) {
                console.error('Erreur lors de la vérification des inscriptions:', err);
                return res.status(500).json({ error: 'Erreur de base de données' });
            }
            
            if (result.count > 0) {
                return res.status(400).json({ 
                    error: `Impossible de supprimer ce créneau car ${result.count} personne(s) y sont inscrites. Veuillez d'abord les désinscrire.` 
                });
            }
            
            // Supprimer le créneau s'il n'y a pas d'inscriptions
            db.run(`DELETE FROM creneaux WHERE id = ?`, [creneauId], function(err) {
                if (err) {
                    console.error('Erreur lors de la suppression:', err);
                    return res.status(500).json({ error: 'Erreur lors de la suppression du créneau' });
                }
                
                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Créneau non trouvé' });
                }
                
                console.log('Créneau supprimé avec succès:', creneauId);
                res.json({ message: 'Créneau supprimé avec succès' });
            });
        });
});

// Route pour forcer la suppression d'un créneau (avec ses inscriptions)
app.delete('/api/creneaux/:creneauId/force', requireAdmin, (req, res) => {
    const creneauId = req.params.creneauId;
    
    console.log('Suppression forcée du créneau:', creneauId);
    
    // Supprimer d'abord toutes les inscriptions
    db.run(`DELETE FROM inscriptions WHERE creneau_id = ?`, [creneauId], (err) => {
        if (err) {
            console.error('Erreur lors de la suppression des inscriptions:', err);
            return res.status(500).json({ error: 'Erreur lors de la suppression des inscriptions' });
        }
        
        // Puis supprimer le créneau
        db.run(`DELETE FROM creneaux WHERE id = ?`, [creneauId], function(err) {
            if (err) {
                console.error('Erreur lors de la suppression du créneau:', err);
                return res.status(500).json({ error: 'Erreur lors de la suppression du créneau' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Créneau non trouvé' });
            }
            
            console.log('Créneau et inscriptions supprimés avec succès:', creneauId);
            res.json({ message: 'Créneau et toutes ses inscriptions supprimés avec succès' });
        });
    });
});

// Routes d'administration des utilisateurs
app.get('/api/admin/users', requireAdmin, (req, res) => {
    const query = `
        SELECT id, email, nom, prenom, role, licence_type, created_at,
               (SELECT COUNT(*) FROM inscriptions WHERE user_id = users.id) as nb_inscriptions
        FROM users 
        ORDER BY created_at DESC
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error('Erreur lors de la récupération des utilisateurs:', err);
            return res.status(500).json({ error: 'Erreur lors de la récupération des utilisateurs' });
        }
        res.json(rows);
    });
});

app.put('/api/admin/users/:userId/role', requireAdmin, (req, res) => {
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
    
    db.run(`UPDATE users SET role = ? WHERE id = ?`, [role, userId], function(err) {
        if (err) {
            console.error('Erreur lors de la modification du rôle:', err);
            return res.status(500).json({ error: 'Erreur lors de la modification du rôle' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Utilisateur non trouvé' });
        }
        
        console.log('Rôle modifié avec succès pour l\'utilisateur:', userId);
        res.json({ message: `Rôle modifié vers "${role}" avec succès` });
    });
});

app.delete('/api/admin/users/:userId', requireAdmin, (req, res) => {
    const userId = req.params.userId;
    
    console.log('Tentative de suppression de l\'utilisateur:', userId);
    
    // Empêcher de se supprimer soi-même
    if (req.session.userId == userId) {
        return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
    }
    
    // Vérifier s'il y a des inscriptions
    db.get(`SELECT COUNT(*) as count FROM inscriptions WHERE user_id = ?`, [userId], (err, result) => {
        if (err) {
            console.error('Erreur lors de la vérification des inscriptions:', err);
            return res.status(500).json({ error: 'Erreur de base de données' });
        }
        
        if (result.count > 0) {
            return res.status(400).json({ 
                error: `Impossible de supprimer cet utilisateur car il a ${result.count} inscription(s) active(s). Veuillez d'abord le désinscrire de tous les créneaux.` 
            });
        }
        
        // Supprimer l'utilisateur
        db.run(`DELETE FROM users WHERE id = ?`, [userId], function(err) {
            if (err) {
                console.error('Erreur lors de la suppression:', err);
                return res.status(500).json({ error: 'Erreur lors de la suppression de l\'utilisateur' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Utilisateur non trouvé' });
            }
            
            console.log('Utilisateur supprimé avec succès:', userId);
            res.json({ message: 'Utilisateur supprimé avec succès' });
        });
    });
});

// Routes pour les limites de séances
app.get('/api/admin/licence-limits', requireAdmin, (req, res) => {
    db.all(`SELECT * FROM licence_limits ORDER BY licence_type`, [], (err, rows) => {
        if (err) {
            console.error('Erreur lors de la récupération des limites:', err);
            return res.status(500).json({ error: 'Erreur lors de la récupération des limites' });
        }
        res.json(rows);
    });
});

app.put('/api/admin/licence-limits/:licenceType', requireAdmin, (req, res) => {
    const licenceType = req.params.licenceType;
    const { max_seances_semaine } = req.body;
    
    if (!max_seances_semaine || max_seances_semaine < 1 || max_seances_semaine > 10) {
        return res.status(400).json({ error: 'Le nombre de séances doit être entre 1 et 10' });
    }
    
    db.run(`UPDATE licence_limits SET max_seances_semaine = ? WHERE licence_type = ?`,
        [max_seances_semaine, licenceType], function(err) {
            if (err) {
                console.error('Erreur lors de la mise à jour:', err);
                return res.status(500).json({ error: 'Erreur lors de la mise à jour' });
            }
            
            if (this.changes === 0) {
                // Créer la limite si elle n'existe pas
                db.run(`INSERT INTO licence_limits (licence_type, max_seances_semaine) VALUES (?, ?)`,
                    [licenceType, max_seances_semaine], (err) => {
                        if (err) {
                            return res.status(500).json({ error: 'Erreur lors de la création' });
                        }
                        res.json({ message: 'Limite créée avec succès' });
                    });
            } else {
                res.json({ message: 'Limite mise à jour avec succès' });
            }
        });
});

// Fonction pour vérifier les limites de séances par semaine
const verifierLimitesSeances = (userId, callback) => {
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

    const query = `
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

    db.get(query, [debutSemaine.toISOString(), finSemaine.toISOString(), userId], (err, result) => {
        if (err) {
            console.error('Erreur lors de la vérification des limites:', err);
            return callback(err, null);
        }

        if (!result) {
            return callback(new Error('Utilisateur non trouvé'), null);
        }

        const limiteAtteinte = result.seances_cette_semaine >= (result.max_seances_semaine || 3);
        
        callback(null, {
            licenceType: result.licence_type,
            maxSeances: result.max_seances_semaine || 3,
            seancesActuelles: result.seances_cette_semaine,
            limiteAtteinte: limiteAtteinte,
            seancesRestantes: Math.max(0, (result.max_seances_semaine || 3) - result.seances_cette_semaine)
        });
    });
};

app.get('/api/mes-limites', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    verifierLimitesSeances(userId, (err, limites) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur lors de la vérification des limites' });
        }
        res.json(limites);
    });
});

// Routes d'administration des créneaux
app.get('/api/admin/inscriptions/:creneauId', requireAdmin, (req, res) => {
    const creneauId = req.params.creneauId;
    
    const query = `
        SELECT i.*, u.nom, u.prenom, u.email
        FROM inscriptions i
        JOIN users u ON i.user_id = u.id
        WHERE i.creneau_id = ?
        ORDER BY 
            CASE WHEN i.statut = 'inscrit' THEN 0 ELSE 1 END,
            i.position_attente ASC,
            i.created_at ASC
    `;
    
    db.all(query, [creneauId], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur lors de la récupération des inscriptions' });
        }
        res.json(rows);
    });
});

// Route d'inscription à un créneau
app.post('/api/inscriptions', requireAuth, (req, res) => {
    const { creneauId } = req.body;
    const userId = req.session.userId;
    
    console.log('Tentative d\'inscription:', { userId, creneauId });
    
    if (!creneauId) {
        return res.status(400).json({ error: 'ID du créneau requis' });
    }
    
    // Vérifier si l'utilisateur est déjà inscrit
    db.get(`SELECT * FROM inscriptions WHERE user_id = ? AND creneau_id = ?`, 
        [userId, creneauId], (err, existingInscription) => {
            if (err) {
                console.error('Erreur vérification inscription:', err);
                return res.status(500).json({ error: 'Erreur de base de données' });
            }
            
            if (existingInscription) {
                return res.status(400).json({ error: 'Vous êtes déjà inscrit à ce créneau' });
            }
            
            // Vérifier les limites de séances
            verifierLimitesSeances(userId, (err, limites) => {
                if (err) {
                    return res.status(500).json({ error: 'Erreur lors de la vérification des limites' });
                }
                
                if (limites.seances_cette_semaine >= limites.max_seances_semaine) {
                    return res.status(400).json({ 
                        error: `Vous avez atteint votre limite de ${limites.max_seances_semaine} séances par semaine` 
                    });
                }
                
                // Vérifier la compatibilité de licence
                db.get(`SELECT u.licence_type, c.licences_autorisees, c.capacite_max, c.nom
                        FROM users u, creneaux c 
                        WHERE u.id = ? AND c.id = ?`, 
                    [userId, creneauId], (err, info) => {
                        if (err) {
                            console.error('Erreur récupération info:', err);
                            return res.status(500).json({ error: 'Erreur de base de données' });
                        }
                        
                        if (!info) {
                            return res.status(404).json({ error: 'Créneau non trouvé' });
                        }
                        
                        const licencesAutorisees = info.licences_autorisees.split(',');
                        if (!licencesAutorisees.includes(info.licence_type)) {
                            return res.status(400).json({ 
                                error: `Votre licence "${info.licence_type}" n'est pas autorisée pour ce créneau` 
                            });
                        }
                        
                        // Compter les inscrits actuels
                        db.get(`SELECT COUNT(*) as inscrits FROM inscriptions WHERE creneau_id = ? AND statut = 'inscrit'`,
                            [creneauId], (err, result) => {
                                if (err) {
                                    console.error('Erreur comptage inscrits:', err);
                                    return res.status(500).json({ error: 'Erreur de base de données' });
                                }
                                
                                const inscritActuels = result.inscrits;
                                const statut = inscritActuels < info.capacite_max ? 'inscrit' : 'attente';
                                let positionAttente = null;
                                
                                if (statut === 'attente') {
                                    // Obtenir la prochaine position sur la liste d'attente
                                    db.get(`SELECT COALESCE(MAX(position_attente), 0) + 1 as next_pos 
                                            FROM inscriptions 
                                            WHERE creneau_id = ? AND statut = 'attente'`,
                                        [creneauId], (err, posResult) => {
                                            if (err) {
                                                console.error('Erreur position attente:', err);
                                                return res.status(500).json({ error: 'Erreur de base de données' });
                                            }
                                            
                                            positionAttente = posResult.next_pos;
                                            
                                            // Insérer l'inscription
                                            db.run(`INSERT INTO inscriptions (user_id, creneau_id, statut, position_attente) 
                                                    VALUES (?, ?, ?, ?)`,
                                                [userId, creneauId, statut, positionAttente], function(err) {
                                                    if (err) {
                                                        console.error('Erreur insertion inscription:', err);
                                                        return res.status(500).json({ error: 'Erreur lors de l\'inscription' });
                                                    }
                                                    
                                                    console.log('Inscription réussie:', { userId, creneauId, statut, positionAttente });
                                                    
                                                    const message = statut === 'inscrit' ? 
                                                        'Inscription réussie' : 
                                                        `Ajouté à la liste d'attente (position ${positionAttente})`;
                                                    
                                                    res.json({ 
                                                        message, 
                                                        statut, 
                                                        positionAttente,
                                                        inscriptionId: this.lastID 
                                                    });
                                                });
                                        });
                                } else {
                                    // Inscription directe
                                    db.run(`INSERT INTO inscriptions (user_id, creneau_id, statut) VALUES (?, ?, ?)`,
                                        [userId, creneauId, statut], function(err) {
                                            if (err) {
                                                console.error('Erreur insertion inscription:', err);
                                                return res.status(500).json({ error: 'Erreur lors de l\'inscription' });
                                            }
                                            
                                            console.log('Inscription réussie:', { userId, creneauId, statut });
                                            res.json({ 
                                                message: 'Inscription réussie', 
                                                statut,
                                                inscriptionId: this.lastID 
                                            });
                                        });
                                }
                            });
                    });
            });
        });
});

// Route de désinscription
app.delete('/api/inscriptions/:creneauId', requireAuth, (req, res) => {
    const creneauId = req.params.creneauId;
    const userId = req.session.userId;
    
    console.log('Tentative de désinscription:', { userId, creneauId });
    
    // Vérifier l'inscription existante
    db.get(`SELECT * FROM inscriptions WHERE user_id = ? AND creneau_id = ?`,
        [userId, creneauId], (err, inscription) => {
            if (err) {
                console.error('Erreur vérification inscription:', err);
                return res.status(500).json({ error: 'Erreur de base de données' });
            }
            
            if (!inscription) {
                return res.status(404).json({ error: 'Inscription non trouvée' });
            }
            
            // Supprimer l'inscription
            db.run(`DELETE FROM inscriptions WHERE user_id = ? AND creneau_id = ?`,
                [userId, creneauId], function(err) {
                    if (err) {
                        console.error('Erreur suppression inscription:', err);
                        return res.status(500).json({ error: 'Erreur lors de la désinscription' });
                    }
                    
                    console.log('Désinscription réussie:', { userId, creneauId });
                    
                    // Si c'était un inscrit (pas en attente), promouvoir le premier de la liste d'attente
                    if (inscription.statut === 'inscrit') {
                        db.get(`SELECT * FROM inscriptions 
                                WHERE creneau_id = ? AND statut = 'attente' 
                                ORDER BY position_attente ASC LIMIT 1`,
                            [creneauId], (err, premierEnAttente) => {
                                if (err) {
                                    console.error('Erreur recherche premier en attente:', err);
                                    return res.json({ message: 'Désinscription réussie' });
                                }
                                
                                if (premierEnAttente) {
                                    // Promouvoir le premier de la liste d'attente
                                    db.run(`UPDATE inscriptions 
                                            SET statut = 'inscrit', position_attente = NULL 
                                            WHERE id = ?`,
                                        [premierEnAttente.id], (err) => {
                                            if (err) {
                                                console.error('Erreur promotion:', err);
                                                return res.json({ message: 'Désinscription réussie' });
                                            }
                                            
                                            // Réorganiser les positions d'attente
                                            db.run(`UPDATE inscriptions 
                                                    SET position_attente = position_attente - 1 
                                                    WHERE creneau_id = ? AND statut = 'attente' AND position_attente > ?`,
                                                [creneauId, premierEnAttente.position_attente], (err) => {
                                                    if (err) {
                                                        console.error('Erreur réorganisation:', err);
                                                    }
                                                    
                                                    console.log('Promotion réussie pour:', premierEnAttente.user_id);
                                                    res.json({ 
                                                        message: 'Désinscription réussie. Une personne a été promue de la liste d\'attente.',
                                                        promotion: true
                                                    });
                                                });
                                        });
                                } else {
                                    res.json({ message: 'Désinscription réussie' });
                                }
                            });
                    } else {
                        // Si c'était quelqu'un en attente, réorganiser les positions
                        db.run(`UPDATE inscriptions 
                                SET position_attente = position_attente - 1 
                                WHERE creneau_id = ? AND statut = 'attente' AND position_attente > ?`,
                            [creneauId, inscription.position_attente], (err) => {
                                if (err) {
                                    console.error('Erreur réorganisation attente:', err);
                                }
                                res.json({ message: 'Désinscription réussie' });
                            });
                    }
                });
        });
});

// Routes d'administration des limites de licence
app.get('/api/admin/licence-limits', requireAdmin, (req, res) => {
    db.all(`SELECT * FROM licence_limits ORDER BY licence_type`, [], (err, rows) => {
        if (err) {
            console.error('Erreur récupération limites:', err);
            return res.status(500).json({ error: 'Erreur lors de la récupération des limites' });
        }
        res.json(rows);
    });
});

app.put('/api/admin/licence-limits/:licenceType', requireAdmin, (req, res) => {
    const licenceType = req.params.licenceType;
    const { max_seances_semaine } = req.body;
    
    console.log('Modification limite licence:', licenceType, 'vers', max_seances_semaine);
    
    if (!max_seances_semaine || max_seances_semaine < 1 || max_seances_semaine > 10) {
        return res.status(400).json({ error: 'Le nombre de séances doit être entre 1 et 10' });
    }
    
    db.run(`UPDATE licence_limits SET max_seances_semaine = ? WHERE licence_type = ?`,
        [max_seances_semaine, licenceType], function(err) {
            if (err) {
                console.error('Erreur modification limite:', err);
                return res.status(500).json({ error: 'Erreur lors de la modification' });
            }
            
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Type de licence non trouvé' });
            }
            
            console.log('Limite modifiée avec succès:', licenceType);
            res.json({ message: 'Limite modifiée avec succès' });
        });
});