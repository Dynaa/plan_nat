# Système de Gestion des Créneaux de Triathlon

## 🏊‍♂️ Description
Application web pour la gestion des inscriptions aux créneaux d'entraînement de triathlon avec système de méta-règles avancé.

## ✨ Fonctionnalités

### Pour les utilisateurs
- **Inscription aux créneaux** avec gestion des listes d'attente
- **Gestion du profil** (nom, prénom, email, mot de passe)
- **Visualisation des inscriptions** en cours
- **Respect des limites** de séances par semaine selon le type de licence

### Pour les administrateurs
- **Gestion des créneaux** (création, modification, suppression)
- **Gestion des utilisateurs** (rôles, types de licence, réinitialisation mot de passe)
- **Méta-règles** : système avancé de restrictions d'inscription
- **Indicateur de statut** des méta-règles en temps réel
- **Limites de séances** configurables par type de licence
- **Remise à zéro hebdomadaire** des inscriptions

### Système de méta-règles
- **Règles conditionnelles** : "Si inscrit le jour X, alors interdire les jours Y, Z..."
- **Par type de licence** : règles spécifiques selon Compétition, Loisir/Senior, etc.
- **Activation/désactivation** globale avec indicateur visuel
- **Logs de débogage** détaillés pour le diagnostic

## 🚀 Déploiement

### Variables d'environnement requises

```bash
# Base de données (optionnel - utilise SQLite par défaut)
DATABASE_URL=postgresql://user:password@host:port/database

# Session (recommandé en production)
SESSION_SECRET=your-super-secret-session-key

# Email (optionnel)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Environnement
NODE_ENV=production
PORT=3000
```

### Déploiement sur Railway

1. **Connecter le repository** à Railway
2. **Configurer les variables d'environnement** dans le dashboard Railway
3. **Déployer** - Railway détecte automatiquement Node.js

### Déploiement local

```bash
# Installation
npm install

# Développement
npm start

# Production
NODE_ENV=production npm start
```

## 🗄️ Base de données

- **SQLite** par défaut (fichier `database.sqlite`)
- **PostgreSQL** supporté via `DATABASE_URL`
- **Auto-migration** au démarrage
- **Données de test** créées automatiquement en développement

## 🔐 Sécurité

- **Authentification** par session
- **Hachage des mots de passe** avec bcrypt
- **Autorisation** par rôles (user/admin)
- **Protection CSRF** intégrée
- **Validation** des données côté serveur

## 📊 Monitoring

- **Logs structurés** avec emojis pour faciliter le debug
- **Logs conditionnels** (détaillés en dev, essentiels en prod)
- **Indicateurs visuels** pour le statut des méta-règles
- **Gestion d'erreurs** complète

## 🛠️ Technologies

- **Backend** : Node.js, Express, SQLite/PostgreSQL
- **Frontend** : HTML5, CSS3, JavaScript vanilla
- **Authentification** : express-session, bcrypt
- **Email** : nodemailer
- **Base de données** : sqlite3, pg

## 📝 Utilisation

### Premier démarrage
1. Créer un compte utilisateur
2. Se connecter en tant qu'admin avec : `admin@triathlon.com` / `admin123`
3. Configurer les méta-règles dans Administration > Méta-règles
4. Créer les créneaux d'entraînement

### Gestion quotidienne
- Les utilisateurs s'inscrivent aux créneaux disponibles
- Les admins surveillent le statut des méta-règles (indicateur vert/orange/gris)
- Remise à zéro hebdomadaire via l'interface admin

## 🔧 Maintenance

### Logs importants à surveiller
- `❌ Erreur` : Erreurs critiques
- `🚫 RÈGLE VIOLÉE` : Violations des méta-règles (dev uniquement)
- `✅ Serveur démarré` : Confirmation du démarrage

### Sauvegarde
- **SQLite** : sauvegarder le fichier `database.sqlite`
- **PostgreSQL** : utiliser `pg_dump`

## 📞 Support

En cas de problème :
1. Vérifier les logs du serveur
2. Vérifier l'indicateur de statut des méta-règles
3. Tester avec les comptes de test (en développement)