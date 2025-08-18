# Guide de Déploiement

## Plateformes recommandées pour les tests

### 1. Railway (Recommandé - Simple et gratuit)
- ✅ Base de données SQLite supportée
- ✅ Variables d'environnement faciles
- ✅ Déploiement automatique depuis GitHub

### 2. Render (Alternative gratuite)
- ✅ Tier gratuit généreux
- ✅ Support Node.js natif
- ✅ SSL automatique

### 3. Heroku (Payant mais populaire)
- ⚠️ Plus de tier gratuit
- ✅ Très documenté
- ✅ Add-ons disponibles

## Variables d'environnement à configurer

```bash
# Base de données (optionnel, SQLite par défaut)
DATABASE_URL=sqlite:./natation.db

# Email (optionnel, Ethereal par défaut)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=votre-email@gmail.com
SMTP_PASS=votre-mot-de-passe-app

# Port (automatique sur la plupart des plateformes)
PORT=3000
```

## Étapes de déploiement

### Railway (Recommandé)

1. **Créez un compte** sur [railway.app](https://railway.app)
2. **Connectez votre repo GitHub**
3. **Déployez** en un clic
4. **Configurez les variables** si nécessaire
5. **Accédez** à votre URL de production

### Render

1. **Créez un compte** sur [render.com](https://render.com)
2. **Nouveau Web Service** depuis GitHub
3. **Configurez** :
   - Build Command: `npm install`
   - Start Command: `npm start`
4. **Déployez**

## Comptes de test en production

Les comptes suivants seront créés automatiquement :
- **Admin** : admin@triathlon.com / admin123
- **Utilisateur** : test@triathlon.com / test123

## Sécurité en production

⚠️ **Important** : Changez les mots de passe par défaut en production !

Ajoutez ces variables pour sécuriser :
```bash
SESSION_SECRET=votre-secret-session-aleatoire-long
ADMIN_EMAIL=votre-email-admin@domain.com
ADMIN_PASSWORD=mot-de-passe-securise
```