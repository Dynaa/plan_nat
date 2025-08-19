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
app.use(session({
    secret: process.env.SESSION_SECRET || 'triathlon-natation-secret-key-dev',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 heures
    }
}));

// Configuration email
const emailConfig = {
    // Pour les tests en développement, on utilise Ethereal Email (faux SMTP)
    // En production, remplacez par vos vraies configurations SMTP
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
        if (!process.env.SMTP_HOST) {
            // Créer un compte de test Ethereal pour le développement
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

        // Vérifier la connexion
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

// Base de données SQLite avec gestion d'erreurs améliorée
const dbPath = process.env.DATABASE_URL || './natation.db';
console.log('Tentative de connexion à la base de données:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Erreur de connexion à la base de données:', err.message);
        console.error('Chemin de la base:', dbPath);
        console.error('Répertoire de travail:', process.cwd());
        console.error('Permissions du répertoire:', process.getuid ? process.getuid() : 'N/A');
    } else {
        console.log('✅ Connexion à la base de données réussie');
    }
});

// Initialisation de la base de données
console.log('🔄 Initialisation de la base de données...');
db.serialize(() => {
    // Table des utilisateurs
    console.log('📋 Création de la table users...');
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        nom TEXT NOT NULL,
        prenom TEXT NOT NULL,
        role TEXT DEFAULT 'membre',
        licence_type TEXT DEFAULT 'Loisir',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Table des limites de séances par type de licence
    db.run(`CREATE TABLE IF NOT EXISTS licence_limits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        licence_type TEXT UNIQUE NOT NULL,
        max_seances_semaine INTEGER NOT NULL DEFAULT 3,
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
        licences_autorisees TEXT DEFAULT 'Compétition,Loisir,Senior,Benjamins/Junior,Poussins/Pupilles',
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

    // Créer un admin par défaut
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@triathlon.com';
    const adminPassword = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);

    db.run(`INSERT OR IGNORE INTO users (email, password, nom, prenom, role) 
            VALUES (?, ?, 'Admin', 'Système', 'admin')`,
        [adminEmail, adminPassword]);

    // Créer un utilisateur de test (seulement en développement)
    if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') {
        const userEmail = 'test@triathlon.com';
        const userPassword = bcrypt.hashSync('test123', 10);

        db.run(`INSERT OR IGNORE INTO users (email, password, nom, prenom, role) 
                VALUES (?, ?, 'Dupont', 'Jean', 'membre')`,
            [userEmail, userPassword]);
    }

    // Migration : Ajouter les colonnes licence_type et licences_autorisees si elles n'existent pas
    db.run(`ALTER TABLE users ADD COLUMN licence_type TEXT DEFAULT 'Loisir/Senior'`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.log('Colonne licence_type déjà présente ou erreur:', err.message);
        }
    });
    
    db.run(`ALTER TABLE creneaux ADD COLUMN licences_autorisees TEXT DEFAULT 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles'`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.log('Colonne licences_autorisees déjà présente ou erreur:', err.message);
        }
    });

    // Créer quelques créneaux de test avec licences spécifiques (seulement s'ils n'existent pas)
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
                        VALUES (?, ?, ?, ?, ?, ?)`, [nom, jour, debut, fin, capacite, licences], (err) => {
                    if (!err) {
                        console.log(`Créneau créé: ${nom}`);
                    }
                });
            });
        }
    });

    // Migration : Fusionner les anciennes licences "Loisir" et "Senior" en "Loisir/Senior"
    db.run(`UPDATE users SET licence_type = 'Loisir/Senior' WHERE licence_type IN ('Loisir', 'Senior')`, (err) => {
        if (!err) {
            console.log('Migration des licences utilisateurs : Loisir et Senior fusionnés en Loisir/Senior');
        }
    });

    // Migration : S'assurer que tous les utilisateurs ont un type de licence
    db.run(`UPDATE users SET licence_type = 'Loisir/Senior' WHERE licence_type IS NULL OR licence_type = ''`, (err) => {
        if (!err) {
            console.log('Migration : Attribution de licence par défaut aux utilisateurs sans licence');
        }
    });

    // Migration : Mettre à jour les créneaux existants (une seule fois)
    db.get(`SELECT COUNT(*) as count FROM creneaux WHERE licences_autorisees LIKE '%Loisir,%' OR licences_autorisees LIKE '%Senior,%' OR licences_autorisees LIKE '%,Loisir%' OR licences_autorisees LIKE '%,Senior%'`, [], (err, result) => {
        if (!err && result.count > 0) {
            console.log('Migration des licences créneaux en cours...');
            db.all(`SELECT id, licences_autorisees FROM creneaux WHERE licences_autorisees IS NOT NULL`, [], (err, creneaux) => {
                if (!err && creneaux) {
                    creneaux.forEach(creneau => {
                        let licences = creneau.licences_autorisees;
                        if (licences.includes('Loisir') || licences.includes('Senior')) {
                            // Séparer les licences
                            let licencesArray = licences.split(',');
                            
                            // Remplacer Loisir et Senior par Loisir/Senior
                            licencesArray = licencesArray.map(licence => {
                                if (licence === 'Loisir' || licence === 'Senior') {
                                    return 'Loisir/Senior';
                                }
                                return licence;
                            });
                            
                            // Supprimer les doublons
                            licencesArray = [...new Set(licencesArray)];
                            const nouvellesLicences = licencesArray.join(',');
                            
                            db.run(`UPDATE creneaux SET licences_autorisees = ? WHERE id = ?`, 
                                [nouvellesLicences, creneau.id], (err) => {
                                    if (!err) {
                                        console.log(`Créneau ${creneau.id} mis à jour: ${nouvellesLicences}`);
                                    }
                                });
                        }
                    });
                }
            });
        }
    });

    // Initialiser les limites par défaut pour chaque type de licence (seulement si elles n'existent pas)
    db.get(`SELECT COUNT(*) as count FROM licence_limits`, [], (err, result) => {
        if (!err && result.count === 0) {
            console.log('Initialisation des limites de séances...');
            const limitesParDefaut = [
                ['Compétition', 6],           // 6 séances par semaine pour la compétition
                ['Loisir/Senior', 3],         // 3 séances par semaine pour loisir/senior
                ['Benjamins/Junior', 4],      // 4 séances par semaine pour benjamins/junior
                ['Poussins/Pupilles', 2]      // 2 séances par semaine pour poussins/pupilles
            ];

            limitesParDefaut.forEach(([licenceType, maxSeances]) => {
                db.run(`INSERT INTO licence_limits (licence_type, max_seances_semaine) 
                        VALUES (?, ?)`, [licenceType, maxSeances], (err) => {
                    if (!err) {
                        console.log(`Limite initialisée: ${licenceType} = ${maxSeances} séances/semaine`);
                    }
                });
            });
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

// Fonctions d'envoi d'email
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
        if (emailConfig.host === 'smtp.ethereal.email') {
            console.log('🔗 Prévisualiser:', nodemailer.getTestMessageUrl(info));
        }
        return true;
    } catch (error) {
        console.error('❌ Erreur envoi email:', error.message);
        return false;
    }
};

const sendInscriptionConfirmation = async (userEmail, userName, creneauNom, creneauDetails) => {
    const subject = `✅ Inscription confirmée - ${creneauNom}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #38a169;">🏊‍♂️ Inscription confirmée !</h2>
            <p>Bonjour <strong>${userName}</strong>,</p>
            <p>Votre inscription au créneau <strong>"${creneauNom}"</strong> a été confirmée.</p>
            <div style="background: #f7fafc; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
                <h3 style="margin: 0 0 0.5rem 0; color: #2d3748;">Détails du créneau :</h3>
                <p style="margin: 0;">${creneauDetails}</p>
            </div>
            <p>Nous vous attendons avec impatience ! 🏊‍♂️</p>
            <hr style="margin: 2rem 0; border: none; border-top: 1px solid #e2e8f0;">
            <p style="color: #718096; font-size: 0.9rem;">
                Club de Triathlon<br>
                Cet email a été envoyé automatiquement, merci de ne pas y répondre.
            </p>
        </div>
    `;

    return await sendEmail(userEmail, subject, html);
};

const sendWaitingListNotification = async (userEmail, userName, creneauNom, position, creneauDetails) => {
    const subject = `⏳ Liste d'attente - ${creneauNom}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ed8936;">⏳ Vous êtes sur liste d'attente</h2>
            <p>Bonjour <strong>${userName}</strong>,</p>
            <p>Vous avez été placé(e) sur la liste d'attente pour le créneau <strong>"${creneauNom}"</strong>.</p>
            <div style="background: #fed7d7; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
                <h3 style="margin: 0 0 0.5rem 0; color: #742a2a;">Position dans la file :</h3>
                <p style="margin: 0; font-size: 1.2rem; font-weight: bold;">N° ${position}</p>
            </div>
            <div style="background: #f7fafc; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
                <h3 style="margin: 0 0 0.5rem 0; color: #2d3748;">Détails du créneau :</h3>
                <p style="margin: 0;">${creneauDetails}</p>
            </div>
            <p>Nous vous préviendrons dès qu'une place se libère ! 📧</p>
            <hr style="margin: 2rem 0; border: none; border-top: 1px solid #e2e8f0;">
            <p style="color: #718096; font-size: 0.9rem;">
                Club de Triathlon<br>
                Cet email a été envoyé automatiquement, merci de ne pas y répondre.
            </p>
        </div>
    `;

    return await sendEmail(userEmail, subject, html);
};

const sendPromotionNotification = async (userEmail, userName, creneauNom, creneauDetails) => {
    const subject = `🎉 Place libérée - ${creneauNom}`;
    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #38a169;">🎉 Bonne nouvelle !</h2>
            <p>Bonjour <strong>${userName}</strong>,</p>
            <p>Une place s'est libérée ! Vous êtes maintenant <strong>inscrit(e)</strong> au créneau <strong>"${creneauNom}"</strong>.</p>
            <div style="background: #c6f6d5; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
                <h3 style="margin: 0 0 0.5rem 0; color: #22543d;">✅ Inscription confirmée</h3>
                <p style="margin: 0;">Vous n'êtes plus sur liste d'attente !</p>
            </div>
            <div style="background: #f7fafc; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
                <h3 style="margin: 0 0 0.5rem 0; color: #2d3748;">Détails du créneau :</h3>
                <p style="margin: 0;">${creneauDetails}</p>
            </div>
            <p>Nous vous attendons avec impatience ! 🏊‍♂️</p>
            <hr style="margin: 2rem 0; border: none; border-top: 1px solid #e2e8f0;">
            <p style="color: #718096; font-size: 0.9rem;">
                Club de Triathlon<br>
                Cet email a été envoyé automatiquement, merci de ne pas y répondre.
            </p>
        </div>
    `;

    return await sendEmail(userEmail, subject, html);
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
        [email, hashedPassword, nom, prenom, licence_type], function (err) {
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
        console.log('Email ou mot de passe manquant');
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
        db.get(`SELECT id, nom, prenom, role FROM users WHERE id = ?`,
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
app.get('/api/creneaux/:creneauId', (req, res) => {
    const creneauId = req.params.creneauId;

    db.get(`SELECT * FROM creneaux WHERE id = ?`, [creneauId], (err, creneau) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur lors de la récupération du créneau' });
        }

        if (!creneau) {
            return res.status(404).json({ error: 'Créneau non trouvé' });
        }

        res.json(creneau);
    });
});

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
            return res.status(500).json({ error: 'Erreur lors de la récupération des créneaux' });
        }
        res.json(rows);
    });
});

app.post('/api/creneaux', requireAdmin, (req, res) => {
    const { nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees } = req.body;

    db.run(`INSERT INTO creneaux (nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees) 
            VALUES (?, ?, ?, ?, ?, ?)`,
        [nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees || 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles'], function (err) {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de la création du créneau' });
            }
            res.json({ message: 'Créneau créé avec succès', creneauId: this.lastID });
        });
});

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
            db.run(`DELETE FROM creneaux WHERE id = ?`, [creneauId], function (err) {
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
        db.run(`DELETE FROM creneaux WHERE id = ?`, [creneauId], function (err) {
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

// Route pour modifier un créneau
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
                [nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees || 'Compétition,Loisir/Senior,Benjamins/Junior,Poussins/Pupilles', creneauId], function (err) {
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

                        // Récupérer les derniers inscrits (par ordre d'inscription) pour les mettre en attente
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
                                    // Mettre ces personnes sur liste d'attente
                                    const ids = derniers.map(d => d.id);
                                    const placeholders = ids.map(() => '?').join(',');

                                    // D'abord, obtenir la position maximale actuelle sur la liste d'attente
                                    db.get(`SELECT COALESCE(MAX(position_attente), 0) as max_pos 
                                            FROM inscriptions 
                                            WHERE creneau_id = ? AND statut = 'attente'`,
                                        [creneauId], (err, maxResult) => {
                                            if (err) {
                                                console.error('Erreur lors de la récupération de la position max:', err);
                                                return res.status(500).json({ error: 'Erreur lors de la gestion des inscriptions' });
                                            }

                                            let startPos = maxResult.max_pos + 1;

                                            // Mettre à jour chaque inscription une par une avec la bonne position
                                            let updatePromises = ids.map((id, index) => {
                                                return new Promise((resolve, reject) => {
                                                    db.run(`UPDATE inscriptions 
                                                            SET statut = 'attente', position_attente = ?
                                                            WHERE id = ?`,
                                                        [startPos + index, id], (err) => {
                                                            if (err) reject(err);
                                                            else resolve();
                                                        });
                                                });
                                            });

                                            Promise.all(updatePromises).then(() => {
                                                // Envoyer notifications de mise en liste d'attente
                                                ids.forEach((inscriptionId, index) => {
                                                    db.get(`SELECT u.email, u.prenom, u.nom, c.nom as creneau_nom, c.jour_semaine, c.heure_debut, c.heure_fin
                                                            FROM users u, creneaux c, inscriptions i
                                                            WHERE i.id = ? AND u.id = i.user_id AND c.id = i.creneau_id`,
                                                        [inscriptionId], (err, userCreneau) => {
                                                            if (!err && userCreneau) {
                                                                const joursMap = { 0: 'Dimanche', 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi', 4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi' };
                                                                const creneauDetails = `${joursMap[userCreneau.jour_semaine]} de ${userCreneau.heure_debut} à ${userCreneau.heure_fin}`;
                                                                const userName = `${userCreneau.prenom} ${userCreneau.nom}`;
                                                                const position = startPos + index;

                                                                sendWaitingListNotification(
                                                                    userCreneau.email,
                                                                    userName,
                                                                    userCreneau.creneau_nom,
                                                                    position,
                                                                    creneauDetails
                                                                );
                                                            }
                                                        });
                                                });

                                                console.log('Créneau modifié avec succès, inscriptions ajustées');
                                                res.json({
                                                    message: `Créneau modifié avec succès. ${aMettreSurListeAttente} personne(s) mise(s) sur liste d'attente.`,
                                                    ajustements: aMettreSurListeAttente
                                                });
                                            }).catch((err) => {
                                                console.error('Erreur lors de la mise en attente:', err);
                                                return res.status(500).json({ error: 'Erreur lors de la mise à jour des inscriptions' });
                                            });
                                        });
                                } else {
                                    res.json({ message: 'Créneau modifié avec succès' });
                                }
                            });
                    } else {
                        // Si la capacité augmente, promouvoir des personnes de la liste d'attente
                        const placesLibres = nouvelleCapacite - inscritActuels;

                        if (placesLibres > 0) {
                            console.log(`Promotion de ${placesLibres} personne(s) de la liste d'attente`);

                            db.all(`SELECT id FROM inscriptions 
                                    WHERE creneau_id = ? AND statut = 'attente' 
                                    ORDER BY position_attente ASC 
                                    LIMIT ?`,
                                [creneauId, placesLibres], (err, aPromouvoir) => {
                                    if (err) {
                                        console.error('Erreur lors de la récupération de la liste d\'attente:', err);
                                        return res.status(500).json({ error: 'Erreur lors de la gestion des inscriptions' });
                                    }

                                    if (aPromouvoir.length > 0) {
                                        const ids = aPromouvoir.map(d => d.id);
                                        const placeholders = ids.map(() => '?').join(',');

                                        db.run(`UPDATE inscriptions 
                                                SET statut = 'inscrit', position_attente = NULL 
                                                WHERE id IN (${placeholders})`,
                                            ids, (err) => {
                                                if (err) {
                                                    console.error('Erreur lors de la promotion:', err);
                                                    return res.status(500).json({ error: 'Erreur lors de la mise à jour des inscriptions' });
                                                }

                                                // Envoyer notifications de promotion
                                                ids.forEach(inscriptionId => {
                                                    db.get(`SELECT u.email, u.prenom, u.nom, c.nom as creneau_nom, c.jour_semaine, c.heure_debut, c.heure_fin
                                                            FROM users u, creneaux c, inscriptions i
                                                            WHERE i.id = ? AND u.id = i.user_id AND c.id = i.creneau_id`,
                                                        [inscriptionId], (err, userCreneau) => {
                                                            if (!err && userCreneau) {
                                                                const joursMap = { 0: 'Dimanche', 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi', 4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi' };
                                                                const creneauDetails = `${joursMap[userCreneau.jour_semaine]} de ${userCreneau.heure_debut} à ${userCreneau.heure_fin}`;
                                                                const userName = `${userCreneau.prenom} ${userCreneau.nom}`;

                                                                sendPromotionNotification(
                                                                    userCreneau.email,
                                                                    userName,
                                                                    userCreneau.creneau_nom,
                                                                    creneauDetails
                                                                );
                                                            }
                                                        });
                                                });

                                                // Réorganiser les positions d'attente restantes
                                                db.run(`UPDATE inscriptions 
                                                        SET position_attente = (
                                                            SELECT COUNT(*) + 1 
                                                            FROM inscriptions i2 
                                                            WHERE i2.creneau_id = inscriptions.creneau_id 
                                                            AND i2.statut = 'attente' 
                                                            AND i2.created_at < inscriptions.created_at
                                                        )
                                                        WHERE creneau_id = ? AND statut = 'attente'`,
                                                    [creneauId], (err) => {
                                                        if (err) {
                                                            console.error('Erreur lors de la réorganisation:', err);
                                                        }

                                                        console.log('Créneau modifié avec succès, promotions effectuées');
                                                        res.json({
                                                            message: `Créneau modifié avec succès. ${aPromouvoir.length} personne(s) promue(s) de la liste d'attente.`,
                                                            promotions: aPromouvoir.length
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
                    }
                });
        });
});

// Routes des inscriptions
app.post('/api/inscriptions', requireAuth, (req, res) => {
    const { creneauId } = req.body;
    const userId = req.session.userId;

    // Vérifier d'abord si l'utilisateur a le bon type de licence
    db.get(`SELECT u.licence_type, c.licences_autorisees, c.nom as creneau_nom
            FROM users u, creneaux c 
            WHERE u.id = ? AND c.id = ?`, [userId, creneauId], (err, userCreneau) => {
        if (err || !userCreneau) {
            return res.status(500).json({ error: 'Erreur lors de la vérification des permissions' });
        }
        
        const licencesAutorisees = userCreneau.licences_autorisees.split(',');
        if (!licencesAutorisees.includes(userCreneau.licence_type)) {
            return res.status(403).json({ 
                error: `Ce créneau est réservé aux licences : ${userCreneau.licences_autorisees}. Votre licence "${userCreneau.licence_type}" n'est pas autorisée.` 
            });
        }

        // Vérifier les limites de séances par semaine
        verifierLimitesSeances(userId, (err, limites) => {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de la vérification des limites' });
            }

            if (limites.limiteAtteinte) {
                return res.status(403).json({ 
                    error: `Limite de séances atteinte ! Votre licence "${limites.licenceType}" vous autorise ${limites.maxSeances} séance(s) par semaine. Vous avez déjà ${limites.seancesActuelles} inscription(s) cette semaine.` 
                });
            }

            // Vérifier si l'utilisateur est déjà inscrit
            db.get(`SELECT * FROM inscriptions WHERE user_id = ? AND creneau_id = ?`,
                [userId, creneauId], (err, existing) => {
                    if (err) {
                        return res.status(500).json({ error: 'Erreur de base de données' });
                    }

                    if (existing) {
                        return res.status(400).json({ error: 'Déjà inscrit à ce créneau' });
                    }

            // Vérifier la capacité du créneau
            db.get(`SELECT c.capacite_max, COUNT(i.id) as inscrits
                    FROM creneaux c
                    LEFT JOIN inscriptions i ON c.id = i.creneau_id AND i.statut = 'inscrit'
                    WHERE c.id = ?
                    GROUP BY c.id`, [creneauId], (err, creneau) => {

                if (err || !creneau) {
                    return res.status(500).json({ error: 'Créneau introuvable' });
                }

                const statut = creneau.inscrits < creneau.capacite_max ? 'inscrit' : 'attente';
                let positionAttente = null;

                if (statut === 'attente') {
                    // Calculer la position dans la liste d'attente
                    db.get(`SELECT COUNT(*) as position FROM inscriptions 
                            WHERE creneau_id = ? AND statut = 'attente'`,
                        [creneauId], (err, result) => {
                            positionAttente = result.position + 1;

                            db.run(`INSERT INTO inscriptions (user_id, creneau_id, statut, position_attente) 
                                    VALUES (?, ?, ?, ?)`,
                                [userId, creneauId, statut, positionAttente], function (err) {
                                    if (err) {
                                        return res.status(500).json({ error: 'Erreur lors de l\'inscription' });
                                    }

                                    // Envoyer notification email pour liste d'attente
                                    db.get(`SELECT u.email, u.prenom, u.nom, c.nom as creneau_nom, c.jour_semaine, c.heure_debut, c.heure_fin
                                            FROM users u, creneaux c 
                                            WHERE u.id = ? AND c.id = ?`, [userId, creneauId], (err, userCreneau) => {
                                        if (!err && userCreneau) {
                                            const joursMap = { 0: 'Dimanche', 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi', 4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi' };
                                            const creneauDetails = `${joursMap[userCreneau.jour_semaine]} de ${userCreneau.heure_debut} à ${userCreneau.heure_fin}`;
                                            const userName = `${userCreneau.prenom} ${userCreneau.nom}`;

                                            sendWaitingListNotification(
                                                userCreneau.email,
                                                userName,
                                                userCreneau.creneau_nom,
                                                positionAttente,
                                                creneauDetails
                                            );
                                        }
                                    });

                                    const message = statut === 'inscrit' ?
                                        'Inscription réussie' :
                                        `Ajouté à la liste d'attente (position ${positionAttente})`;

                                    res.json({ message, statut, positionAttente });
                                });
                        });
                } else {
                    db.run(`INSERT INTO inscriptions (user_id, creneau_id, statut) VALUES (?, ?, ?)`,
                        [userId, creneauId, statut], function (err) {
                            if (err) {
                                return res.status(500).json({ error: 'Erreur lors de l\'inscription' });
                            }

                            // Envoyer notification email pour inscription confirmée
                            db.get(`SELECT u.email, u.prenom, u.nom, c.nom as creneau_nom, c.jour_semaine, c.heure_debut, c.heure_fin
                                    FROM users u, creneaux c 
                                    WHERE u.id = ? AND c.id = ?`, [userId, creneauId], (err, userCreneau) => {
                                if (!err && userCreneau) {
                                    const joursMap = { 0: 'Dimanche', 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi', 4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi' };
                                    const creneauDetails = `${joursMap[userCreneau.jour_semaine]} de ${userCreneau.heure_debut} à ${userCreneau.heure_fin}`;
                                    const userName = `${userCreneau.prenom} ${userCreneau.nom}`;

                                    sendInscriptionConfirmation(
                                        userCreneau.email,
                                        userName,
                                        userCreneau.creneau_nom,
                                        creneauDetails
                                    );
                                }
                            });

                            res.json({ message: 'Inscription réussie', statut });
                        });
                }
            });
        });
        });
    });
});

app.delete('/api/inscriptions/:creneauId', requireAuth, (req, res) => {
    const creneauId = req.params.creneauId;
    const userId = req.session.userId;

    db.run(`DELETE FROM inscriptions WHERE user_id = ? AND creneau_id = ?`,
        [userId, creneauId], function (err) {
            if (err) {
                return res.status(500).json({ error: 'Erreur lors de la désinscription' });
            }

            if (this.changes === 0) {
                return res.status(404).json({ error: 'Inscription non trouvée' });
            }

            // Promouvoir le premier de la liste d'attente
            db.get(`SELECT * FROM inscriptions 
                    WHERE creneau_id = ? AND statut = 'attente' 
                    ORDER BY position_attente ASC LIMIT 1`,
                [creneauId], (err, nextInLine) => {

                    if (nextInLine) {
                        db.run(`UPDATE inscriptions 
                                SET statut = 'inscrit', position_attente = NULL 
                                WHERE id = ?`, [nextInLine.id], (err) => {
                            if (!err) {
                                // Envoyer notification de promotion
                                db.get(`SELECT u.email, u.prenom, u.nom, c.nom as creneau_nom, c.jour_semaine, c.heure_debut, c.heure_fin
                                                FROM users u, creneaux c, inscriptions i
                                                WHERE i.id = ? AND u.id = i.user_id AND c.id = i.creneau_id`,
                                    [nextInLine.id], (err, userCreneau) => {
                                        if (!err && userCreneau) {
                                            const joursMap = { 0: 'Dimanche', 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi', 4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi' };
                                            const creneauDetails = `${joursMap[userCreneau.jour_semaine]} de ${userCreneau.heure_debut} à ${userCreneau.heure_fin}`;
                                            const userName = `${userCreneau.prenom} ${userCreneau.nom}`;

                                            sendPromotionNotification(
                                                userCreneau.email,
                                                userName,
                                                userCreneau.creneau_nom,
                                                creneauDetails
                                            );
                                        }
                                    });
                            }
                        });

                        // Mettre à jour les positions d'attente
                        db.run(`UPDATE inscriptions 
                                SET position_attente = position_attente - 1 
                                WHERE creneau_id = ? AND statut = 'attente'`, [creneauId]);
                    }

                    res.json({ message: 'Désinscription réussie' });
                });
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
            console.error('Query:', query);
            console.error('UserId:', userId);
            return res.status(500).json({ 
                error: 'Erreur lors de la récupération des inscriptions',
                details: process.env.NODE_ENV === 'development' ? err.message : undefined
            });
        }
        console.log('Inscriptions trouvées:', rows.length);
        res.json(rows);
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

app.get('/api/mes-limites', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    verifierLimitesSeances(userId, (err, limites) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur lors de la vérification des limites' });
        }
        res.json(limites);
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

    db.run(`UPDATE users SET role = ? WHERE id = ?`, [role, userId], function (err) {
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
        db.run(`DELETE FROM users WHERE id = ?`, [userId], function (err) {
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

// Health check pour les plateformes de déploiement
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        database: 'SQLite',
        features: ['inscriptions', 'licences', 'limites', 'emails']
    });
});

// Page de statut publique
app.get('/status', (req, res) => {
    db.get(`SELECT COUNT(*) as users FROM users`, [], (err, userCount) => {
        if (err) {
            return res.json({
                status: 'Erreur',
                error: 'Problème de base de données',
                details: err.message,
                timestamp: new Date().toISOString()
            });
        }
        
        db.get(`SELECT COUNT(*) as creneaux FROM creneaux WHERE actif = 1`, [], (err2, creneauCount) => {
            db.get(`SELECT COUNT(*) as inscriptions FROM inscriptions`, [], (err3, inscriptionCount) => {
                res.json({
                    status: 'Opérationnel',
                    version: '1.0.0',
                    environment: process.env.NODE_ENV || 'development',
                    database: {
                        path: process.env.DATABASE_URL || './natation.db',
                        writable: true
                    },
                    stats: {
                        utilisateurs: userCount ? userCount.users : 0,
                        creneaux_actifs: creneauCount ? creneauCount.creneaux : 0,
                        inscriptions_totales: inscriptionCount ? inscriptionCount.inscriptions : 0
                    },
                    timestamp: new Date().toISOString()
                });
            });
        });
    });
});

// Route de diagnostic détaillé
app.get('/debug', (req, res) => {
    const diagnostics = {
        environment: process.env.NODE_ENV,
        cwd: process.cwd(),
        platform: process.platform,
        nodeVersion: process.version,
        databasePath: process.env.DATABASE_URL || './natation.db'
    };
    
    // Test de la base de données
    db.get(`SELECT name FROM sqlite_master WHERE type='table'`, [], (err, tables) => {
        if (err) {
            diagnostics.database = { error: err.message };
        } else {
            diagnostics.database = { status: 'OK', tables: 'found' };
        }
        
        res.json(diagnostics);
    });
});

// Servir les fichiers statiques
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
    console.log('=== Comptes de test ===');
    console.log('Admin: admin@triathlon.com / admin123');
    console.log('Utilisateur: test@triathlon.com / test123');
    console.log('=====================');
    console.log('Appuyez sur Ctrl+C pour arrêter le serveur');
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} occupé, tentative sur le port ${PORT + 1}...`);
        server.listen(PORT + 1);
    } else {
        console.error('Erreur serveur:', err);
    }
});