// Script pour mettre à jour toutes les requêtes vers l'adaptateur
// Ce fichier sert de référence pour les modifications à faire

// Exemple de conversion :

// AVANT (SQLite direct) :
// db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
//     if (err) return res.status(500).json({ error: 'Erreur' });
//     res.json(user);
// });

// APRÈS (Adaptateur) :
// try {
//     const user = await db.get(`SELECT * FROM users WHERE email = ?`, [email]);
//     res.json(user);
// } catch (err) {
//     console.error('Erreur:', err);
//     res.status(500).json({ error: 'Erreur' });
// }

// Les principales modifications :
// 1. Remplacer les callbacks par async/await
// 2. Utiliser try/catch pour la gestion d'erreurs
// 3. Les méthodes db.get(), db.query(), db.run() retournent des Promises

console.log('Ce fichier sert de référence pour les conversions de requêtes');
console.log('Les routes seront mises à jour progressivement vers async/await');