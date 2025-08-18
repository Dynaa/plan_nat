# Application de Gestion des Créneaux Natation - Club de Triathlon

## Fonctionnalités
- Création de comptes utilisateurs
- Inscription/désinscription aux créneaux
- Limitation du nombre de participants par créneau
- Liste d'attente automatique
- Interface d'administration pour gérer les inscriptions
- Rôles utilisateur (membre/administrateur)

## Technologies
- Frontend: HTML, CSS, JavaScript (Vanilla)
- Backend: Node.js avec Express
- Base de données: SQLite (simple et portable)
- Authentification: Sessions simples

## Installation
```bash
npm install
npm start
```

L'application sera accessible sur http://localhost:3000

## Déploiement

Voir le fichier [DEPLOYMENT.md](DEPLOYMENT.md) pour les instructions de déploiement sur Railway, Render ou Heroku.

### Déploiement rapide sur Railway

1. Fork ce repository sur GitHub
2. Créez un compte sur [railway.app](https://railway.app)
3. Connectez votre repository GitHub
4. Déployez en un clic !

L'application sera automatiquement accessible avec une URL publique.

## Comptes de test

**Administrateur :**
- Email : admin@triathlon.com
- Mot de passe : admin123

**Utilisateur membre :**
- Email : test@triathlon.com
- Mot de passe : test123

## Créneaux de test

L'application créera automatiquement quelques créneaux d'exemple :
- Natation Débutants (Lundi 18h-19h, 8 places)
- Natation Confirmés (Lundi 19h-20h, 6 places)
- Natation Technique (Mercredi 12h-13h, 10 places)
- Natation Endurance (Vendredi 18h30-19h30, 12 places)
- Natation Libre (Samedi 10h-11h, 15 places)

## Notifications par email

L'application envoie automatiquement des emails pour :
- ✅ **Confirmation d'inscription** : Quand un utilisateur s'inscrit à un créneau
- ⏳ **Mise en liste d'attente** : Quand un créneau est complet
- 🎉 **Promotion** : Quand une place se libère et qu'on passe de la liste d'attente aux inscrits
- 📝 **Changements de statut** : Lors de modifications de créneaux par les admins

### Configuration email

**Mode développement :** L'application utilise automatiquement Ethereal Email (emails de test)
- Les emails ne sont pas vraiment envoyés
- Vous pouvez les prévisualiser via les liens affichés dans la console

**Mode production :** Pour recevoir de vrais emails :

1. **Modifiez le fichier `.env`** et décommentez les lignes Gmail :
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=votre-email@gmail.com
SMTP_PASS=votre-mot-de-passe-app
```

2. **Configuration Gmail** :
   - Activez l'authentification à 2 facteurs
   - Générez un "mot de passe d'application" dans les paramètres Google
   - Utilisez ce mot de passe dans SMTP_PASS

3. **Redémarrez l'application** pour appliquer la configurationlaces) p11h, 15edi 10h-(SamLibre tion 
- Nataplaces)12 0-19h30, redi 18h3rance (Vendtation Endu Na places)
-2h-13h, 10credi 1e (Mern Techniqutios)
- Natalace, 6 p0h19h-2 (Lundi onfirmés- Natation C8 places)
-19h, 8h 1ndiutants (Luatation Déb
- Nxemple :aux d'eelques créneiquement qua automatréercation c
L'applix de test
neau3

## Créest12se : tot de pasom
- M.chlont@triatmail : tesre :**
- Eisateur membUtil
**admin123
:  de passe com
- Moton.n@triathl: admimail :**
- Eistrateur 

**Admintes de test
## Comp