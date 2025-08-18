# Guide de Déploiement - Domaine OVH

## Option recommandée : Railway + Domaine OVH

### 1. Préparer le code

```bash
# Initialiser Git (si pas déjà fait)
git init
git add .
git commit -m "Version prête pour déploiement"

# Créer le repository sur GitHub
# Aller sur github.com → New repository → "gestion-creneaux-natation"

# Lier au repository
git remote add origin https://github.com/VOTRE-USERNAME/gestion-creneaux-natation.git
git branch -M main
git push -u origin main
```

### 2. Déployer sur Railway

1. **Aller sur [railway.app](https://railway.app)**
2. **Se connecter avec GitHub**
3. **New Project → Deploy from GitHub repo**
4. **Sélectionner votre repository**
5. **Railway détecte automatiquement Node.js et déploie**

### 3. Configurer les variables d'environnement sur Railway

Dans le dashboard Railway, aller dans **Variables** et ajouter :

```
NODE_ENV=production
SESSION_SECRET=votre-secret-session-super-long-et-aleatoire
ADMIN_EMAIL=admin@votredomaine.com
ADMIN_PASSWORD=VotreMotDePasseSecurise123!
```

### 4. Configurer le domaine sur OVH

#### A. Dans Railway :
1. **Settings → Domains**
2. **Custom Domain → Ajouter votre domaine**
3. **Noter l'adresse CNAME fournie** (ex: `xxx.up.railway.app`)

#### B. Dans l'espace client OVH :
1. **Aller dans "Noms de domaine"**
2. **Sélectionner votre domaine**
3. **Zone DNS → Ajouter une entrée**
4. **Type : CNAME**
5. **Sous-domaine : natation** (ou www, ou laissez vide pour le domaine principal)
6. **Cible : l'adresse Railway** (ex: `xxx.up.railway.app`)
7. **Sauvegarder**

### 5. Attendre la propagation DNS (15min à 24h)

Votre application sera accessible sur :
- `https://natation.votredomaine.com` (si sous-domaine)
- `https://www.votredomaine.com` (si www)
- `https://votredomaine.com` (si domaine principal)

## Alternative : VPS OVH (Plus technique)

Si vous préférez un VPS OVH :

### 1. Commander un VPS OVH
- **VPS Starter** (~3€/mois) suffit largement
- **OS : Ubuntu 22.04 LTS**

### 2. Configuration du serveur
```bash
# Se connecter en SSH
ssh ubuntu@votre-ip-vps

# Installer Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Installer PM2 (gestionnaire de processus)
sudo npm install -g pm2

# Installer Nginx (serveur web)
sudo apt update
sudo apt install nginx

# Cloner votre repository
git clone https://github.com/VOTRE-USERNAME/gestion-creneaux-natation.git
cd gestion-creneaux-natation
npm install

# Configurer les variables d'environnement
cp .env.production .env
# Éditer .env avec vos vraies valeurs

# Démarrer l'application
pm2 start server.js --name "natation-app"
pm2 startup
pm2 save
```

### 3. Configuration Nginx
```nginx
# /etc/nginx/sites-available/natation
server {
    listen 80;
    server_name votredomaine.com www.votredomaine.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Activer le site
sudo ln -s /etc/nginx/sites-available/natation /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Installer SSL avec Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d votredomaine.com -d www.votredomaine.com
```

### 4. Configuration DNS OVH pour VPS
- **Type A : votredomaine.com → IP du VPS**
- **Type A : www.votredomaine.com → IP du VPS**

## Recommandation

**Pour débuter : Railway + Domaine OVH**
- Plus simple
- Maintenance automatique
- Déploiement en 1 clic
- SSL automatique
- Coût : ~5$/mois + domaine

**Pour plus tard : VPS OVH**
- Plus de contrôle
- Moins cher à long terme
- Apprentissage de l'administration serveur
- Coût : ~3€/mois + domaine