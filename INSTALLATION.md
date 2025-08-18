# Instructions d'installation

## 1. Installer Node.js

1. Allez sur https://nodejs.org
2. Téléchargez la version LTS (recommandée)
3. Lancez l'installateur et suivez les instructions
4. **IMPORTANT :** Redémarrez votre terminal/invite de commande après l'installation

## 2. Vérifier l'installation

Ouvrez un nouveau terminal et tapez :
```bash
node --version
npm --version
```

Vous devriez voir les numéros de version s'afficher.

## 3. Installer les dépendances

Dans le dossier de l'application, exécutez :
```bash
npm install
```

## 4. Démarrer l'application

```bash
npm start
```

Ou double-cliquez sur le fichier `start.bat`

## 5. Accéder à l'application

Ouvrez votre navigateur et allez sur : http://localhost:3000

## Compte administrateur par défaut

- Email : admin@triathlon.com
- Mot de passe : admin123

## Résolution des problèmes

### Erreur "fetch is not defined"
Si vous obtenez cette erreur, votre version de Node.js est trop ancienne. 
Mettez à jour vers Node.js 18+ ou utilisez la commande :
```bash
node --experimental-fetch server.js
```

### Port déjà utilisé
Si le port 3000 est occupé, l'application vous proposera automatiquement un autre port.

### Problèmes de base de données
Le fichier `natation.db` sera créé automatiquement au premier lancement.
En cas de problème, supprimez ce fichier et relancez l'application.