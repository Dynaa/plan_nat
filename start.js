#!/usr/bin/env node

// Script de démarrage optimisé pour Railway
// Supprime les warnings npm et configure l'environnement

console.log('🚀 Démarrage de l\'application...');

// Supprimer les warnings npm en production
if (process.env.NODE_ENV === 'production') {
    // Supprimer le warning npm config production
    process.env.npm_config_production = 'true';
    
    // Supprimer les warnings de dépréciation
    process.env.NODE_NO_WARNINGS = '1';
    
    console.log('🔧 Configuration production activée');
    console.log('📦 Variables d\'environnement configurées');
}

// Forcer NODE_ENV en production si pas défini
if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'production';
    console.log('🔧 NODE_ENV forcé en production');
}

console.log('📡 Démarrage du serveur principal...');

// Démarrer le serveur principal
require('./server.js');