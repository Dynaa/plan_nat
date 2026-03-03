const DatabaseAdapter = require('./database');
const db = new DatabaseAdapter();

async function migrate() {
    console.log('🔄 Démarrage de la migration des dates...');

    try {
        if (db.isPostgres) {
            console.log('🐘 PostgreSQL détecté.');

            // 1. Ajouter la colonne date_seance
            await db.pool.query(`
                ALTER TABLE inscriptions 
                ADD COLUMN IF NOT EXISTS date_seance DATE;
            `);

            // 2. Mettre à jour les enregistrements existants (utiliser la date actuelle par défaut)
            await db.pool.query(`
                UPDATE inscriptions 
                SET date_seance = CURRENT_DATE 
                WHERE date_seance IS NULL;
            `);

            // 3. Rendre la colonne NOT NULL
            await db.pool.query(`
                ALTER TABLE inscriptions 
                ALTER COLUMN date_seance SET NOT NULL;
            `);

            // 4. Supprimer l'ancienne contrainte UNIQUE
            await db.pool.query(`
                ALTER TABLE inscriptions 
                DROP CONSTRAINT IF EXISTS inscriptions_user_id_creneau_id_key;
            `);

            // 5. Ajouter la nouvelle contrainte UNIQUE avec date_seance
            await db.pool.query(`
                ALTER TABLE inscriptions 
                ADD CONSTRAINT inscriptions_user_id_creneau_id_date_seance_key 
                UNIQUE (user_id, creneau_id, date_seance);
            `);

            console.log('✅ Migration PostgreSQL terminée.');
        } else {
            console.log('💾 SQLite détecté. Utilisation de la méthode de recréation de table.');

            await new Promise((resolve, reject) => {
                db.db.serialize(() => {
                    db.db.run('BEGIN TRANSACTION;');

                    // 1. Renommer la table existante
                    db.db.run('ALTER TABLE inscriptions RENAME TO inscriptions_old_backup;');

                    // 2. Créer la nouvelle table avec la bonne structure
                    db.db.run(`
                        CREATE TABLE inscriptions (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            user_id INTEGER NOT NULL,
                            creneau_id INTEGER NOT NULL,
                            date_seance TEXT NOT NULL,
                            statut TEXT DEFAULT 'inscrit',
                            position_attente INTEGER NULL,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY (user_id) REFERENCES users (id),
                            FOREIGN KEY (creneau_id) REFERENCES creneaux (id),
                            UNIQUE(user_id, creneau_id, date_seance)
                        )
                    `);

                    // 3. Copier les données avec une date par défaut (aujourd'hui)
                    const today = new Date().toISOString().split('T')[0];
                    db.db.run(`
                        INSERT INTO inscriptions (id, user_id, creneau_id, date_seance, statut, position_attente, created_at)
                        SELECT id, user_id, creneau_id, '${today}', statut, position_attente, created_at
                        FROM inscriptions_old_backup
                    `);

                    // 4. Supprimer l'ancienne table
                    db.db.run('DROP TABLE inscriptions_old_backup;');

                    db.db.run('COMMIT;', (err) => {
                        if (err) {
                            console.error('Erreur SQL:', err);
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            });

            console.log('✅ Migration SQLite terminée.');
        }
        process.exit(0);
    } catch (err) {
        console.error('❌ Erreur lors de la migration:', err);
        process.exit(1);
    }
}

migrate();
