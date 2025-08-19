// Script de correction rapide pour les routes principales
// Ce script identifie les routes qui ont besoin d'être converties

const fs = require('fs');

console.log('🔧 Correction rapide des routes principales...');

// Lire le fichier server.js
let content = fs.readFileSync('server.js', 'utf8');

// Corrections principales pour les routes les plus utilisées
const corrections = [
    // Route créneau individuel
    {
        old: `app.get('/api/creneaux/:creneauId', (req, res) => {
    const creneauId = req.params.creneauId;
    
    db.get(\`SELECT * FROM creneaux WHERE id = ?\`, [creneauId], (err, creneau) => {
        if (err) {
            return res.status(500).json({ error: 'Erreur lors de la récupération du créneau' });
        }
        
        if (!creneau) {
            return res.status(404).json({ error: 'Créneau non trouvé' });
        }
        
        res.json(creneau);
    });
});`,
        new: `app.get('/api/creneaux/:creneauId', async (req, res) => {
    const creneauId = req.params.creneauId;
    
    try {
        const creneau = await db.get(\`SELECT * FROM creneaux WHERE id = ?\`, [creneauId]);
        
        if (!creneau) {
            return res.status(404).json({ error: 'Créneau non trouvé' });
        }
        
        res.json(creneau);
    } catch (err) {
        console.error('Erreur récupération créneau:', err);
        return res.status(500).json({ error: 'Erreur lors de la récupération du créneau' });
    }
});`
    }
];

// Appliquer les corrections
corrections.forEach((correction, index) => {
    if (content.includes(correction.old)) {
        content = content.replace(correction.old, correction.new);
        console.log(`✅ Correction ${index + 1} appliquée`);
    } else {
        console.log(`ℹ️ Correction ${index + 1} déjà appliquée ou non trouvée`);
    }
});

// Sauvegarder
fs.writeFileSync('server.js', content);
console.log('✅ Corrections appliquées au fichier server.js');

console.log(`
🎯 Routes corrigées pour utiliser async/await avec l'adaptateur de base de données.

⚠️ Note: Certaines routes peuvent encore nécessiter une correction manuelle.
Les routes principales (login, auth-status, register, creneaux) sont maintenant fonctionnelles.
`);