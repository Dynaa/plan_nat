# Test de l'Application sur Railway

## 🔍 Vérifications dans les Logs Railway

### 1. **Vérifier la Détection PostgreSQL**
Cherchez ces messages dans les logs :
```
🔍 Variables d'environnement Railway:
- NODE_ENV: production
- DATABASE_URL présente: true
🔍 Type de base: PostgreSQL
🐘 Utilisation de PostgreSQL
✅ PostgreSQL initialisé avec succès
```

### 2. **Vérifier le Démarrage du Serveur**
```
✅ Serveur démarré sur le port 8080
```

## 🧪 Tests à Effectuer

### 1. **Test de Connexion Admin**
- Aller sur l'URL Railway
- Essayer de se connecter avec :
  - Email: `admin@triathlon.com` (ou votre ADMIN_EMAIL)
  - Mot de passe: `admin123` (ou votre ADMIN_PASSWORD)

### 2. **Test de Création de Compte**
- Cliquer sur "Créer un compte"
- Remplir le formulaire avec un email de test
- Vérifier que le compte se crée sans erreur

### 3. **Test des Créneaux**
- Une fois connecté, vérifier que les créneaux s'affichent
- Tester l'inscription à un créneau

## 🚨 Erreurs Possibles et Solutions

### **Erreur: "syntax error at end of input"**
- ✅ **Corrigé** : Conversion des requêtes SQLite vers PostgreSQL

### **Erreur: "DATABASE_URL présente: false"**
**Solution :**
1. Dans Railway, vérifier que PostgreSQL est ajouté au projet
2. Dans les variables du service web, `DATABASE_URL` doit être présente
3. Si manquante, ajouter manuellement la connexion PostgreSQL

### **Erreur: "Utilisateur non trouvé"**
**Causes possibles :**
1. La base PostgreSQL est vide (pas d'admin créé)
2. L'initialisation PostgreSQL a échoué

**Solution :**
1. Vérifier les logs pour `✅ PostgreSQL initialisé avec succès`
2. Si manquant, vérifier les variables `ADMIN_EMAIL` et `ADMIN_PASSWORD`

### **Erreur de Session**
**Solution :**
Vérifier que `SESSION_SECRET` est définie dans les variables Railway

## 📋 Checklist de Déploiement

- [ ] PostgreSQL ajouté au projet Railway
- [ ] `DATABASE_URL` présente dans les variables
- [ ] `NODE_ENV=production` définie
- [ ] `SESSION_SECRET` définie (sécurisée)
- [ ] `ADMIN_EMAIL` et `ADMIN_PASSWORD` définies
- [ ] Logs montrent "PostgreSQL" et non "SQLite"
- [ ] Connexion admin fonctionne
- [ ] Créneaux s'affichent correctement

## 🔧 Variables d'Environnement Requises

```env
NODE_ENV=production
DATABASE_URL=postgresql://... (automatique Railway)
SESSION_SECRET=votre-secret-securise
ADMIN_EMAIL=admin@votre-domaine.com
ADMIN_PASSWORD=votre-mot-de-passe-securise
```

## 📞 Support

Si problème persistant :
1. Copier les logs d'erreur Railway
2. Vérifier la configuration des variables
3. Redéployer si nécessaire avec `git push`