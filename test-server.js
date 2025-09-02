// Serveur de test ultra-minimal pour Railway
console.log('🧪 Démarrage du serveur de test...');

const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

console.log('📊 Variables d\'environnement:');
console.log('- NODE_ENV:', process.env.NODE_ENV);
console.log('- PORT:', process.env.PORT);
console.log('- RAILWAY_ENVIRONMENT:', process.env.RAILWAY_ENVIRONMENT);

// Health check ultra-simple
app.get('/ping', (req, res) => {
    console.log('🏓 Ping reçu de:', req.ip);
    res.status(200).send('pong');
});

app.get('/health', (req, res) => {
    console.log('🔍 Health check reçu de:', req.ip);
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    console.log('🏠 Accueil demandé de:', req.ip);
    res.status(200).send('Serveur de test Railway OK');
});

// Démarrage
console.log(`🚀 Tentative d'écoute sur 0.0.0.0:${PORT}`);

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Serveur de test démarré !`);
    console.log(`📡 Écoute sur 0.0.0.0:${PORT}`);
    console.log(`🔗 Test local: http://localhost:${PORT}/ping`);
});

server.on('error', (err) => {
    console.error('❌ Erreur serveur:', err);
    process.exit(1);
});

// Logs de debug
setInterval(() => {
    console.log('💓 Serveur vivant -', new Date().toISOString());
}, 30000);