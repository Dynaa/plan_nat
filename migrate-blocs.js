/**
 * migrate-blocs.js
 * 
 * Script de migration pour Railway :
 * - Ajoute nombre_lignes et personnes_par_ligne à la table creneaux
 * - Crée les tables blocs et bloc_creneaux
 * - Migre les données existantes (capacite_max → 2 lignes × (capacite_max/2) personnes)
 * - Insère les 3 blocs de référence
 * 
 * Exécution : node migrate-blocs.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrate() {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        console.log('🔄 Début de la migration blocs...');

        // 1. Ajouter les nouvelles colonnes à creneaux (si elles n'existent pas)
        await client.query(`
            ALTER TABLE creneaux 
            ADD COLUMN IF NOT EXISTS nombre_lignes INTEGER NOT NULL DEFAULT 2
        `);
        await client.query(`
            ALTER TABLE creneaux 
            ADD COLUMN IF NOT EXISTS personnes_par_ligne INTEGER NOT NULL DEFAULT 6
        `);
        console.log('✅ Colonnes nombre_lignes et personnes_par_ligne ajoutées à creneaux');

        // 2. Migrer les données existantes : si capacite_max existe, calculer depuis elle
        const hasCapaciteMax = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'creneaux' AND column_name = 'capacite_max'
        `);

        if (hasCapaciteMax.rows.length > 0) {
            // Calculer nombre_lignes et personnes_par_ligne depuis capacite_max
            // Hypothèse : 6 personnes par ligne → nombre_lignes = ceil(capacite_max / 6)
            await client.query(`
                UPDATE creneaux 
                SET nombre_lignes = CEIL(capacite_max::float / 6),
                    personnes_par_ligne = 6
                WHERE nombre_lignes = 2 AND personnes_par_ligne = 6
            `);
            console.log('✅ Données migrées depuis capacite_max');

            // Optionnel : supprimer l'ancienne colonne
            // await client.query('ALTER TABLE creneaux DROP COLUMN IF EXISTS capacite_max');
            // Pour la compatibilité, on garde capacite_max pour l'instant
        }

        // 3. Créer la table blocs
        await client.query(`
            CREATE TABLE IF NOT EXISTS blocs (
                id SERIAL PRIMARY KEY,
                nom VARCHAR(255) NOT NULL,
                description TEXT,
                ordre INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Table blocs créée');

        // 4. Créer la table bloc_creneaux
        await client.query(`
            CREATE TABLE IF NOT EXISTS bloc_creneaux (
                bloc_id INTEGER NOT NULL,
                creneau_id INTEGER NOT NULL,
                PRIMARY KEY (bloc_id, creneau_id),
                FOREIGN KEY (bloc_id) REFERENCES blocs(id) ON DELETE CASCADE,
                FOREIGN KEY (creneau_id) REFERENCES creneaux(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ Table bloc_creneaux créée');

        // 5. Insérer les 3 blocs de référence si pas encore présents
        const blocsCount = await client.query('SELECT COUNT(*) as count FROM blocs');
        if (parseInt(blocsCount.rows[0].count) === 0) {
            const [blocDebut] = (await client.query(`
                INSERT INTO blocs (nom, description, ordre) VALUES ($1, $2, $3) RETURNING id
            `, ['Début de semaine', 'Lundi et Mardi', 1])).rows;

            const [blocMilieu] = (await client.query(`
                INSERT INTO blocs (nom, description, ordre) VALUES ($1, $2, $3) RETURNING id
            `, ['Milieu de semaine', 'Mercredi, Jeudi et Vendredi', 2])).rows;

            const [blocFin] = (await client.query(`
                INSERT INTO blocs (nom, description, ordre) VALUES ($1, $2, $3) RETURNING id
            `, ['Fin de semaine', 'Samedi', 3])).rows;

            console.log('✅ 3 blocs de référence créés');

            // 6. Associer les créneaux existants aux blocs selon le jour_semaine
            //    Début : Lundi (1), Mardi (2)
            //    Milieu : Mercredi (3), Jeudi (4), Vendredi (5)
            //    Fin : Samedi (6), Dimanche (7)
            const creneaux = await client.query('SELECT id, jour_semaine FROM creneaux ORDER BY id');

            for (const c of creneaux.rows) {
                let blocId;
                if ([1, 2].includes(c.jour_semaine)) {
                    blocId = blocDebut.id;
                } else if ([3, 4, 5].includes(c.jour_semaine)) {
                    blocId = blocMilieu.id;
                } else if ([6, 7].includes(c.jour_semaine)) {
                    blocId = blocFin.id;
                }

                if (blocId) {
                    await client.query(`
                        INSERT INTO bloc_creneaux (bloc_id, creneau_id) VALUES ($1, $2)
                        ON CONFLICT DO NOTHING
                    `, [blocId, c.id]);
                }
            }
            console.log('✅ Créneaux existants associés aux blocs selon leur jour_semaine');
        } else {
            console.log('ℹ️ Des blocs existent déjà, pas d\'insertion');
        }

        await client.query('COMMIT');
        console.log('🎉 Migration terminée avec succès !');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Erreur migration, rollback effectué:', err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate().catch(err => {
    console.error(err);
    process.exit(1);
});
