// Script pour corriger rapidement toutes les requêtes PostgreSQL
const fs = require('fs');

console.log('🔧 Correction des requêtes PostgreSQL...');

let serverContent = fs.readFileSync('server.js', 'utf8');

// Fonction pour convertir les requêtes callback en async/await
function convertToAsync(content) {
    // Remplacer les patterns de requêtes callback par async/await
    
    // Pattern 1: db.get avec callback
    content = content.replace(
        /db\.get\(`([^`]+)`\s*,\s*(\[[^\]]*\])\s*,\s*\(err,\s*(\w+)\)\s*=>\s*{([^}]+(?:{[^}]*}[^}]*)*?)}\s*\);/gs,
        (match, query, params, resultVar, body) => {
            const pgQuery = query.replace(/\?/g, (match, offset) => {
                const paramIndex = (query.substring(0, offset).match(/\?/g) || []).length + 1;
                return `$${paramIndex}`;
            });
            
            return `try {
        const sql = db.isPostgres ? \`${pgQuery}\` : \`${query}\`;
        const ${resultVar} = await db.get(sql, ${params});
        ${body.replace(/if \(err\)[^}]*}/g, '').replace(/return res\.status\(500\)\.json\([^)]*\);/g, '')}
    } catch (err) {
        console.error('Erreur base de données:', err);
        return res.status(500).json({ error: 'Erreur de base de données' });
    }`;
        }
    );
    
    // Pattern 2: db.all avec callback
    content = content.replace(
        /db\.all\(`([^`]+)`\s*,\s*(\[[^\]]*\])\s*,\s*\(err,\s*(\w+)\)\s*=>\s*{([^}]+(?:{[^}]*}[^}]*)*?)}\s*\);/gs,
        (match, query, params, resultVar, body) => {
            const pgQuery = query.replace(/\?/g, (match, offset) => {
                const paramIndex = (query.substring(0, offset).match(/\?/g) || []).length + 1;
                return `$${paramIndex}`;
            });
            
            return `try {
        const sql = db.isPostgres ? \`${pgQuery}\` : \`${query}\`;
        const ${resultVar} = await db.query(sql, ${params});
        ${body.replace(/if \(err\)[^}]*}/g, '').replace(/return res\.status\(500\)\.json\([^)]*\);/g, '')}
    } catch (err) {
        console.error('Erreur base de données:', err);
        return res.status(500).json({ error: 'Erreur de base de données' });
    }`;
        }
    );
    
    // Pattern 3: db.run avec callback
    content = content.replace(
        /db\.run\(`([^`]+)`\s*,\s*(\[[^\]]*\])\s*,\s*function\(err\)\s*{([^}]+(?:{[^}]*}[^}]*)*?)}\s*\);/gs,
        (match, query, params, body) => {
            const pgQuery = query.replace(/\?/g, (match, offset) => {
                const paramIndex = (query.substring(0, offset).match(/\?/g) || []).length + 1;
                return `$${paramIndex}`;
            });
            
            return `try {
        const sql = db.isPostgres ? \`${pgQuery}\` : \`${query}\`;
        const result = await db.run(sql, ${params});
        ${body.replace(/if \(err\)[^}]*}/g, '').replace(/this\.lastID/g, 'result.lastID').replace(/this\.changes/g, 'result.changes')}
    } catch (err) {
        console.error('Erreur base de données:', err);
        return res.status(500).json({ error: 'Erreur de base de données' });
    }`;
        }
    );
    
    return content;
}

// Convertir les fonctions en async
function makeRoutesAsync(content) {
    // Convertir les routes en async si elles ne le sont pas déjà
    content = content.replace(
        /app\.(get|post|put|delete)\('([^']+)',\s*([^,]*),?\s*\(req,\s*res\)\s*=>\s*{/g,
        'app.$1(\'$2\', $3async (req, res) => {'
    );
    
    // Nettoyer les doubles async
    content = content.replace(/async async/g, 'async');
    
    return content;
}

// Appliquer les corrections
serverContent = makeRoutesAsync(serverContent);
serverContent = convertToAsync(serverContent);

// Sauvegarder
fs.writeFileSync('server.js', serverContent);

console.log('✅ Requêtes PostgreSQL corrigées !');
console.log('📝 Vérifiez le fichier server.js et testez l\'application');