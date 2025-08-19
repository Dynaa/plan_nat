# Guide de Déploiement Railway avec PostgreSQL

## Étapes de Déploiement

### 1. Préparation du Projet

✅ Le projet est déjà configuré avec :
- Adaptateur de base de données (SQLite/PostgreSQL)
- Scripts d'initialisation PostgreSQL
- Configuration Railway (railway.json, Procfile)
- Variables d'environnement (.env.example)

### 2. Déploiement sur Railway

1. **Connecter le Repository GitHub**
   - Aller sur [railway.app](https://railway.app)
   - Se connecter avec GitHub
   - Créer un nouveau projet
   - Connecter le repository `plan_nat`

2. **Ajouter PostgreSQL**
   - Dans le projet Railway, cliquer sur "Add Service"
   - Sélectionner "Database" → "PostgreSQL"
   - Railway créera automatiquement une base PostgreSQL

3. **Configurer les Variables d'Environnement**
   
   Dans l'onglet "Variables" du service web, ajouter :
   
   ```
   NODE_ENV=production
   SESSION_SECRET=votre-secret-session-super-securise-ici
   ADMIN_EMAIL=admin@votre-domaine.com
   ADMIN_PASSWORD=votre-mot-de-passe-admin-securise
   ```
   
   **Variables Email (optionnelles) :**
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=votre-email@gmail.com
   SMTP_PASS=votre-mot-de-passe-app
   ```

4. **Variables Automatiques Railway**
   
   Railway configurera automatiquement :
   - `DATABASE_URL` (connexion PostgreSQL)
   - `PORT` (port du service)
   - `RAILWAY_ENVIRONMENT` (production)

### 3. Déploiement Automatique

1. **Premier Déploiement**
   - Railway détectera automatiquement le `package.json`
   - Il installera les dépendances
   - Lancera `npm start` (qui exécute `node server.js`)

2. **Initialisation de la Base**
   - L'application détectera automatiquement PostgreSQL via `DATABASE_URL`
   - Les tables seront créées au premier démarrage
   - L'admin par défaut sera créé

### 4. Vérification du Déploiement

1. **Vérifier les Logs**
   - Dans Railway, aller dans l'onglet "Logs"
   - Vérifier les messages :
     ```
     🐘 Utilisation de PostgreSQL
     ✅ PostgreSQL initialisé avec succès
     ✅ Serveur démarré sur le port XXXX
     ```

2. **Tester l'Application**
   - Cliquer sur l'URL générée par Railway
   - Se connecter avec les identifiants admin configurés
   - Tester les fonctionnalités principales

### 5. Configuration Post-Déploiement

1. **Domaine Personnalisé (optionnel)**
   - Dans Railway, aller dans "Settings" → "Domains"
   - Ajouter votre domaine personnalisé

2. **Monitoring**
   - Railway fournit des métriques automatiques
   - Configurer des alertes si nécessaire

### 6. Maintenance

1. **Mises à Jour**
   - Pousser les changements sur GitHub
   - Railway redéploiera automatiquement

2. **Sauvegarde**
   - Railway sauvegarde automatiquement PostgreSQL
   - Possibilité d'exporter les données si nécessaire

## Variables d'Environnement Complètes

```env
# Production
NODE_ENV=production

# Base de données (automatique Railway)
DATABASE_URL=postgresql://...

# Sécurité
SESSION_SECRET=votre-secret-session-super-securise-ici

# Admin
ADMIN_EMAIL=admin@votre-domaine.com
ADMIN_PASSWORD=votre-mot-de-passe-admin-securise

# Email (optionnel)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=votre-email@gmail.com
SMTP_PASS=votre-mot-de-passe-app

# Railway (automatique)
PORT=3000
RAILWAY_ENVIRONMENT=production
```

## Commandes Utiles

```bash
# Tester localement avec PostgreSQL
npm run init-postgres

# Migrer depuis SQLite (si nécessaire)
npm run migrate

# Démarrer en développement
npm run dev

# Démarrer en production
npm start
```

## Dépannage

### Problème de Connexion Base
- Vérifier que `DATABASE_URL` est définie
- Vérifier les logs Railway pour les erreurs PostgreSQL

### Problème d'Email
- Les emails sont optionnels en production
- Vérifier la configuration SMTP si activée

### Problème de Session
- Vérifier que `SESSION_SECRET` est définie
- En production, les sessions utilisent des cookies sécurisés

## Support

- Documentation Railway : https://docs.railway.app
- Logs en temps réel dans l'interface Railway
- Métriques et monitoring intégrés