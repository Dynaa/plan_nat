# Checklist de Sécurité - Production

## ⚠️ IMPORTANT - À faire avant le déploiement

### 1. Variables d'environnement sensibles

**Dans Railway, configurer ces variables :**

```
NODE_ENV=production
SESSION_SECRET=GenerezUnSecretTresLongEtAleatoire123456789!
ADMIN_EMAIL=admin@votredomaine.com
ADMIN_PASSWORD=UnMotDePasseTresSecurise123!
```

**Générateur de secret de session :**
```javascript
// Exécuter dans la console du navigateur pour générer un secret
console.log(require('crypto').randomBytes(64).toString('hex'));
```

### 2. Comptes par défaut

**⚠️ CHANGEZ IMMÉDIATEMENT :**
- Email admin par défaut : `admin@triathlon.com`
- Mot de passe par défaut : `admin123`

**Utilisez les variables d'environnement :**
- `ADMIN_EMAIL` : Votre vraie adresse email
- `ADMIN_PASSWORD` : Un mot de passe fort

### 3. Base de données

**✅ SQLite est OK pour commencer**
- Fichier `natation.db` créé automatiquement
- Sauvegardé avec l'application sur Railway
- Pour plus tard : migrer vers PostgreSQL si besoin

### 4. HTTPS

**✅ Automatique avec Railway**
- SSL/TLS configuré automatiquement
- Certificats renouvelés automatiquement

### 5. Emails

**Mode développement (par défaut) :**
- Utilise Ethereal Email (emails de test)
- Pas d'envoi réel

**Mode production (optionnel) :**
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=votre-email@gmail.com
SMTP_PASS=votre-mot-de-passe-app-gmail
```

### 6. Monitoring

**URLs de vérification :**
- `https://votredomaine.com/health` - Statut technique
- `https://votredomaine.com/status` - Statistiques publiques

### 7. Sauvegardes

**Railway :**
- Sauvegarde automatique du code
- Base de données SQLite incluse dans l'application

**Recommandation :**
- Exporter régulièrement la base de données
- Sauvegarder le fichier `natation.db`

## 🚀 Après le déploiement

### 1. Tests de sécurité
- [ ] Connexion admin avec nouveaux identifiants
- [ ] Création d'un compte utilisateur test
- [ ] Vérification des permissions (admin vs utilisateur)
- [ ] Test des inscriptions et limites

### 2. Configuration DNS
- [ ] Domaine pointe vers Railway
- [ ] HTTPS fonctionne
- [ ] Redirection www → domaine principal (ou inverse)

### 3. Monitoring
- [ ] `/health` retourne OK
- [ ] `/status` affiche les bonnes statistiques
- [ ] Logs Railway sans erreurs

## 🔒 Sécurité continue

### Mises à jour
- Surveiller les mises à jour de sécurité Node.js
- Mettre à jour les dépendances npm régulièrement

### Surveillance
- Vérifier les logs Railway régulièrement
- Surveiller les tentatives de connexion suspectes

### Sauvegardes
- Exporter la base de données mensuellement
- Tester la restauration des sauvegardes