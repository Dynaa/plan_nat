// services/semainesTypes.js

// Semaines types. Un club n'a pas le même planning en période scolaire et
// pendant les vacances. Les créneaux forment une bibliothèque ; une semaine
// type en est une sélection, et un même créneau peut servir à plusieurs
// semaines types. Chaque semaine du calendrier suit la semaine type choisie
// par un admin, sinon celle par défaut.

const seances = require('./seances');

const NOM_PAR_DEFAUT = 'Semaine standard';

// Motif d'annulation d'une séance retirée par un changement de semaine type :
// elle revit si la semaine revient à une semaine type qui contient son créneau.
const MOTIF_SEMAINE_TYPE = 'semaine_type';

class ErreurSemaineType extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
        this.metier = true;
    }
}

// --- Schéma et migration ------------------------------------------------

const colonneExiste = async (db, table, colonne) => {
    if (db.isPostgres) {
        return !!(await db.get(
            `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
            [table, colonne]
        ));
    }
    const colonnes = await db.query(`PRAGMA table_info(${table})`);
    return colonnes.some(c => c.name === colonne);
};

// Migrations à ne jouer qu'une fois (elles ne sont pas idempotentes)
const migrationUnique = async (db, nom, migration) => {
    await db.run(db.adaptSQL(
        `CREATE TABLE IF NOT EXISTS migrations_appliquees (nom TEXT PRIMARY KEY, appliquee_le DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS migrations_appliquees (nom VARCHAR(100) PRIMARY KEY, appliquee_le TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
    ));
    if (await db.get(`SELECT nom FROM migrations_appliquees WHERE nom = ?`, [nom])) return;
    await migration();
    await db.run(`INSERT INTO migrations_appliquees (nom) VALUES (?)`, [nom]);
};

// Réglages qui rendent deux créneaux interchangeables (fusion des doublons)
const CHAMPS_IDENTITE = ['nom', 'sport_id', 'jour_semaine', 'heure_debut', 'heure_fin', 'capacite_max',
    'lieu', 'nombre_lignes', 'personnes_par_ligne', 'public_cible'];

const cleDuCreneau = (creneau, blocs) => JSON.stringify([
    ...CHAMPS_IDENTITE.map(c => String(creneau[c] ?? '').trim()),
    seances.estVrai(creneau.sans_limite),
    blocs.slice().sort()
]);

// Remplace le créneau `doublonId` par `garderId` partout, puis le supprime.
// Deux séances à la même date se fondent en une : celle qui a lieu (ou, à
// défaut, la plus remplie) accueille les inscrits de l'autre.
const fusionnerCreneau = async (db, garderId, doublonId) => {
    await db.run(
        `INSERT INTO semaine_type_creneaux (semaine_type_id, creneau_id)
         SELECT l.semaine_type_id, ? FROM semaine_type_creneaux l
         WHERE l.creneau_id = ? AND NOT EXISTS (
             SELECT 1 FROM semaine_type_creneaux d WHERE d.creneau_id = ? AND d.semaine_type_id = l.semaine_type_id
         )`,
        [garderId, doublonId, garderId]
    );
    await db.run(`DELETE FROM semaine_type_creneaux WHERE creneau_id = ?`, [doublonId]);
    await db.run(`DELETE FROM bloc_creneaux WHERE creneau_id = ?`, [doublonId]); // mêmes blocs que le créneau gardé

    const nbInscriptions = async (seanceId) =>
        parseInt((await db.get(`SELECT COUNT(*) AS n FROM inscriptions WHERE seance_id = ?`, [seanceId])).n, 10) || 0;

    const seancesDoublon = await db.query(`SELECT id, date_seance, annulee FROM seances WHERE creneau_id = ?`, [doublonId]);
    for (const seance of seancesDoublon) {
        const autre = await db.get(
            `SELECT id, annulee FROM seances WHERE creneau_id = ? AND date_seance = ?`,
            [garderId, seance.date_seance]
        );
        if (!autre) {
            await db.run(`UPDATE seances SET creneau_id = ? WHERE id = ?`, [garderId, seance.id]);
            continue;
        }

        const score = async (s) => [seances.estVrai(s.annulee) ? 0 : 1, await nbInscriptions(s.id), -s.id];
        const [a, b] = [await score(seance), await score(autre)];
        const doublonGagne = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
        const [garde, perdue] = doublonGagne ? [seance, autre] : [autre, seance];

        const inscriptions = await db.query(`SELECT id, user_id FROM inscriptions WHERE seance_id = ?`, [perdue.id]);
        for (const inscription of inscriptions) {
            const deja = await db.get(`SELECT id FROM inscriptions WHERE seance_id = ? AND user_id = ?`, [garde.id, inscription.user_id]);
            if (deja) {
                await db.run(`DELETE FROM inscriptions WHERE id = ?`, [inscription.id]);
            } else {
                await db.run(`UPDATE inscriptions SET seance_id = ?, creneau_id = ? WHERE id = ?`, [garde.id, garderId, inscription.id]);
            }
        }
        await db.run(`DELETE FROM waitlist_tokens WHERE seance_id = ?`, [perdue.id]);
        await db.run(`DELETE FROM seances WHERE id = ?`, [perdue.id]);
        await db.run(`UPDATE seances SET creneau_id = ? WHERE id = ?`, [garderId, garde.id]);
        await seances.renumeroterAttente(db, garde.id);
    }

    await db.run(`UPDATE inscriptions SET creneau_id = ? WHERE creneau_id = ?`, [garderId, doublonId]);
    await db.run(`UPDATE waitlist_tokens SET creneau_id = ? WHERE creneau_id = ?`, [garderId, doublonId]);
    await db.run(`DELETE FROM creneaux WHERE id = ?`, [doublonId]);
};

const fusionnerDoublons = async (db) => {
    const creneaux = await db.query(`SELECT * FROM creneaux WHERE actif = true ORDER BY id`);
    const blocs = await db.query(`SELECT bloc_id, creneau_id FROM bloc_creneaux`);
    const premiers = new Map();
    let fusionnes = 0;

    for (const creneau of creneaux) {
        const cle = cleDuCreneau(creneau, blocs.filter(b => b.creneau_id === creneau.id).map(b => String(b.bloc_id)));
        if (premiers.has(cle)) {
            await fusionnerCreneau(db, premiers.get(cle), creneau.id);
            fusionnes++;
        } else {
            premiers.set(cle, creneau.id);
        }
    }
    if (fusionnes > 0) console.log(`🔄 ${fusionnes} créneau(x) en double fusionné(s)`);
};

// À lancer après la création des créneaux d'exemple.
const migrer = async (db) => {
    await db.run(db.adaptSQL(
        `CREATE TABLE IF NOT EXISTS semaines_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nom TEXT NOT NULL,
            par_defaut BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS semaines_types (
            id SERIAL PRIMARY KEY,
            nom VARCHAR(255) NOT NULL,
            par_defaut BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    ));

    // Semaine type choisie pour une semaine du calendrier (repérée par son lundi)
    await db.run(db.adaptSQL(
        `CREATE TABLE IF NOT EXISTS semaines (
            lundi TEXT PRIMARY KEY,
            semaine_type_id INTEGER NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (semaine_type_id) REFERENCES semaines_types (id)
        )`,
        `CREATE TABLE IF NOT EXISTS semaines (
            lundi DATE PRIMARY KEY,
            semaine_type_id INTEGER NOT NULL REFERENCES semaines_types (id),
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    ));

    // Créneaux sélectionnés par chaque semaine type
    await db.run(db.adaptSQL(
        `CREATE TABLE IF NOT EXISTS semaine_type_creneaux (
            semaine_type_id INTEGER NOT NULL,
            creneau_id INTEGER NOT NULL,
            PRIMARY KEY (semaine_type_id, creneau_id),
            FOREIGN KEY (semaine_type_id) REFERENCES semaines_types (id) ON DELETE CASCADE,
            FOREIGN KEY (creneau_id) REFERENCES creneaux (id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS semaine_type_creneaux (
            semaine_type_id INTEGER NOT NULL REFERENCES semaines_types (id) ON DELETE CASCADE,
            creneau_id INTEGER NOT NULL REFERENCES creneaux (id) ON DELETE CASCADE,
            PRIMARY KEY (semaine_type_id, creneau_id)
        )`
    ));
    await db.run(`CREATE INDEX IF NOT EXISTS idx_semaine_type_creneaux_creneau ON semaine_type_creneaux (creneau_id)`);

    // Ancienne appartenance d'un créneau à une seule semaine type. La colonne
    // n'est plus utilisée qu'à la reprise ci-dessous ; elle reste en base pour
    // permettre un retour à la version précédente.
    if (!(await colonneExiste(db, 'creneaux', 'semaine_type_id'))) {
        await db.run(`ALTER TABLE creneaux ADD COLUMN semaine_type_id INTEGER REFERENCES semaines_types (id)`);
    }
    if (!(await colonneExiste(db, 'seances', 'motif_annulation'))) {
        await db.run(`ALTER TABLE seances ADD COLUMN motif_annulation ${db.isPostgres ? 'VARCHAR(50)' : 'TEXT'}`);
        console.log('🔄 Colonne seances.motif_annulation ajoutée');
    }

    if (!(await typeParDefaut(db))) {
        const existante = await db.get(`SELECT id FROM semaines_types ORDER BY id LIMIT 1`);
        if (existante) {
            await db.run(`UPDATE semaines_types SET par_defaut = true WHERE id = ?`, [existante.id]);
        } else {
            await db.run(
                db.adaptSQL(
                    `INSERT INTO semaines_types (nom, par_defaut) VALUES (?, true)`,
                    `INSERT INTO semaines_types (nom, par_defaut) VALUES (?, true) RETURNING id`
                ),
                [NOM_PAR_DEFAUT]
            );
            console.log(`🔄 Semaine type « ${NOM_PAR_DEFAUT} » créée`);
        }
    }

    // Reprise : chaque créneau rejoint sa semaine type d'origine (par défaut
    // s'il n'en avait pas), puis les copies identiques issues d'une
    // duplication se fondent en un seul créneau partagé.
    await migrationUnique(db, 'creneaux_partages_entre_semaines_types', async () => {
        const defaut = await typeParDefaut(db);
        const lies = await db.run(
            `INSERT INTO semaine_type_creneaux (semaine_type_id, creneau_id)
             SELECT COALESCE(c.semaine_type_id, ?), c.id FROM creneaux c
             WHERE NOT EXISTS (SELECT 1 FROM semaine_type_creneaux l WHERE l.creneau_id = c.id)`,
            [defaut.id]
        );
        if (lies.changes > 0) {
            console.log(`🔄 ${lies.changes} créneau(x) rattaché(s) à leur semaine type`);
        }
        await fusionnerDoublons(db);
    });
};

// --- Lecture --------------------------------------------------------------

const normaliserType = (row) => row && {
    ...row,
    par_defaut: seances.estVrai(row.par_defaut),
    ...(row.nb_creneaux !== undefined ? { nb_creneaux: parseInt(row.nb_creneaux, 10) || 0 } : {})
};

const typeParDefaut = async (db) => normaliserType(
    await db.get(`SELECT id, nom, par_defaut FROM semaines_types WHERE par_defaut = true ORDER BY id LIMIT 1`)
);

const trouverType = async (db, id) => normaliserType(
    await db.get(`SELECT id, nom, par_defaut FROM semaines_types WHERE id = ?`, [id])
);

const listerTypes = async (db) => (await db.query(
    `SELECT t.id, t.nom, t.par_defaut,
            (SELECT COUNT(*) FROM semaine_type_creneaux l JOIN creneaux c ON c.id = l.creneau_id
             WHERE l.semaine_type_id = t.id AND c.actif = true) AS nb_creneaux
     FROM semaines_types t
     ORDER BY t.par_defaut DESC, t.nom`
)).map(normaliserType);

// Identifiants des créneaux actifs sélectionnés par une semaine type
const creneauxDuType = async (db, typeId) => (await db.query(
    `SELECT c.id FROM creneaux c
     JOIN semaine_type_creneaux l ON l.creneau_id = c.id
     WHERE l.semaine_type_id = ? AND c.actif = true`,
    [typeId]
)).map(c => c.id);

// Semaine type suivie par la semaine commençant `lundi`
const typeDeLaSemaine = async (db, lundi) => {
    const choix = await db.get(
        `SELECT t.id, t.nom, t.par_defaut FROM semaines s
         JOIN semaines_types t ON t.id = s.semaine_type_id
         WHERE s.lundi = ?`,
        [lundi]
    );
    if (choix) return { ...normaliserType(choix), explicite: true };

    const defaut = await typeParDefaut(db);
    return defaut ? { ...defaut, explicite: false } : null;
};

// Les semaines ouvertes à l'administration, avec leur semaine type et leur remplissage
const planning = async (db, nombre = seances.SEMAINES_ADMIN) => {
    const semaines = [];
    for (let offset = 0; offset < nombre; offset++) {
        const lundi = seances.lundiDeLaSemaine(offset);
        const dimanche = seances.ajouterJours(lundi, 6);
        const compte = await db.get(
            `SELECT
                 (SELECT COUNT(*) FROM seances WHERE date_seance BETWEEN ? AND ? AND annulee = false) AS nb_seances,
                 (SELECT COUNT(*) FROM inscriptions i JOIN seances s ON s.id = i.seance_id
                  WHERE s.date_seance BETWEEN ? AND ?) AS nb_inscriptions`,
            [lundi, dimanche, lundi, dimanche]
        );
        const type = await typeDeLaSemaine(db, lundi);
        semaines.push({
            offset,
            lundi,
            dimanche,
            semaine_type_id: type ? type.id : null,
            semaine_type_nom: type ? type.nom : null,
            explicite: type ? type.explicite : false,
            nb_seances: parseInt(compte.nb_seances, 10) || 0,
            nb_inscriptions: parseInt(compte.nb_inscriptions, 10) || 0
        });
    }
    return semaines;
};

// --- Gestion des semaines types ------------------------------------------

const nomValide = (nom) => {
    const propre = String(nom ?? '').trim();
    if (!propre) throw new ErreurSemaineType('Le nom de la semaine type est requis');
    if (propre.length > 100) throw new ErreurSemaineType('Nom trop long (100 caractères maximum)');
    return propre;
};

const creerType = async (db, nom) => {
    const resultat = await db.run(
        db.adaptSQL(
            `INSERT INTO semaines_types (nom, par_defaut) VALUES (?, false)`,
            `INSERT INTO semaines_types (nom, par_defaut) VALUES (?, false) RETURNING id`
        ),
        [nomValide(nom)]
    );
    return trouverType(db, resultat.lastID);
};

// Nouvelle semaine type reprenant la sélection d'une autre (mêmes créneaux, partagés)
const dupliquerType = async (db, sourceId, nom) => {
    const source = await trouverType(db, sourceId);
    if (!source) throw new ErreurSemaineType('Semaine type non trouvée', 404);

    const copie = await creerType(db, nom);
    const resultat = await db.run(
        `INSERT INTO semaine_type_creneaux (semaine_type_id, creneau_id)
         SELECT ?, creneau_id FROM semaine_type_creneaux WHERE semaine_type_id = ?`,
        [copie.id, source.id]
    );
    return { ...copie, nb_creneaux: resultat.changes || 0 };
};

const renommerType = async (db, id, nom) => {
    const resultat = await db.run(`UPDATE semaines_types SET nom = ? WHERE id = ?`, [nomValide(nom), id]);
    if (!resultat.changes) throw new ErreurSemaineType('Semaine type non trouvée', 404);
    return trouverType(db, id);
};

// Supprimer une semaine type ne touche pas aux créneaux, qui restent dans la
// bibliothèque. Elle ne doit plus être en service (par défaut, semaines à venir).
const supprimerType = async (db, id) => {
    const type = await trouverType(db, id);
    if (!type) throw new ErreurSemaineType('Semaine type non trouvée', 404);
    if (type.par_defaut) {
        throw new ErreurSemaineType('La semaine type par défaut ne peut pas être supprimée : choisissez-en une autre par défaut d\'abord');
    }

    const aVenir = await db.get(
        `SELECT COUNT(*) AS n FROM semaines WHERE semaine_type_id = ? AND lundi >= ?`,
        [id, seances.lundiDeLaSemaine(0)]
    );
    if (parseInt(aVenir.n, 10) > 0) {
        throw new ErreurSemaineType(`Cette semaine type est appliquée à ${aVenir.n} semaine(s) à venir : choisissez-en une autre pour ces semaines d'abord`);
    }

    await db.run(`DELETE FROM semaine_type_creneaux WHERE semaine_type_id = ?`, [id]);
    await db.run(`DELETE FROM semaines WHERE semaine_type_id = ?`, [id]);
    await db.run(`DELETE FROM semaines_types WHERE id = ?`, [id]);
};

// --- Application à une semaine ---------------------------------------------

const lundiValide = (lundi) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(lundi)) || seances.jourSemaineDe(lundi) !== 1) {
        throw new ErreurSemaineType('La semaine doit être désignée par la date de son lundi (AAAA-MM-JJ)');
    }
    if (lundi < seances.lundiDeLaSemaine(0)) {
        throw new ErreurSemaineType('Impossible de modifier une semaine passée');
    }
    if (lundi > seances.lundiDeLaSemaine(seances.SEMAINES_ADMIN - 1)) {
        throw new ErreurSemaineType(`Seules les ${seances.SEMAINES_ADMIN} prochaines semaines se planifient`);
    }
};

// Fait suivre à une semaine la semaine type `typeId`, sans toucher aux jours
// passés ni aux séances ponctuelles :
// - une séance dont le créneau figure dans la semaine type est conservée ;
// - les autres sont annulées et leurs inscrits désinscrits ;
// - les séances manquantes sont créées, celles annulées par un précédent
//   changement de semaine type sont rétablies. Une annulation décidée par un
//   admin est respectée.
//
// Options :
// - `simulation` : rien n'est écrit, le résultat décrit l'impact ;
// - `explicite: false` : applique la semaine type sans l'enregistrer comme un
//   choix (la semaine continue de suivre la semaine type par défaut) ;
// - `selection` : créneaux à considérer à la place de ceux de la semaine type
//   (aperçu d'une sélection pas encore enregistrée).
//
// Renvoie { lundi, semaine_type, conservees, creees, reactivees, annulees: [{ seance, inscrits }] }.
const appliquerType = async (db, lundi, typeId, { simulation = false, explicite = true, selection = null } = {}) => {
    lundiValide(lundi);
    const type = await trouverType(db, typeId);
    if (!type) throw new ErreurSemaineType('Semaine type non trouvée', 404);

    const dimanche = seances.ajouterJours(lundi, 6);
    const aujourdhui = seances.aujourdhuiIso();
    const retenus = new Set((selection || await creneauxDuType(db, type.id)).map(String));
    const retenu = (s) => retenus.has(String(s.creneau_id));

    const seancesSemaine = (await db.query(
        `SELECT * FROM seances WHERE date_seance BETWEEN ? AND ? ORDER BY date_seance, heure_debut, id`,
        [lundi, dimanche]
    )).map(row => ({ ...row, date_seance: seances.normaliserDate(row.date_seance), annulee: seances.estVrai(row.annulee) }));

    const aVenir = seancesSemaine.filter(s => s.creneau_id && s.date_seance >= aujourdhui);
    const conservees = aVenir.filter(s => !s.annulee && retenu(s));
    const aAnnuler = aVenir.filter(s => !s.annulee && !retenu(s));
    const aReactiver = aVenir.filter(s => s.annulee && s.motif_annulation === MOTIF_SEMAINE_TYPE && retenu(s));

    const presents = new Set(seancesSemaine.map(s => String(s.creneau_id)));
    const creneauxACreer = retenus.size === 0 ? [] : await db.query(
        `SELECT id, jour_semaine FROM creneaux
         WHERE actif = true AND id IN (${[...retenus].map(() => '?').join(', ')})`,
        [...retenus]
    );
    const creees = creneauxACreer.filter(c => !presents.has(String(c.id))
        && seances.dateDuJour(lundi, c.jour_semaine) >= aujourdhui).length;

    const annulees = [];
    for (const seance of aAnnuler) {
        const inscrits = await db.query(
            `SELECT i.user_id, i.statut, u.email, u.nom, u.prenom
             FROM inscriptions i JOIN users u ON u.id = i.user_id
             WHERE i.seance_id = ?
             ORDER BY i.statut DESC, i.position_attente`,
            [seance.id]
        );
        const { id, creneau_id, nom, date_seance, heure_debut, heure_fin } = seance;
        annulees.push({ seance: { id, creneau_id, nom, date_seance, heure_debut, heure_fin }, inscrits });
    }

    const bilan = {
        lundi,
        semaine_type: type,
        conservees: conservees.length,
        creees,
        reactivees: aReactiver.length,
        annulees
    };
    if (simulation) return bilan;

    if (explicite) {
        await db.run(
            db.adaptSQL(
                `INSERT INTO semaines (lundi, semaine_type_id) VALUES (?, ?)
                 ON CONFLICT (lundi) DO UPDATE SET semaine_type_id = excluded.semaine_type_id, updated_at = CURRENT_TIMESTAMP`,
                `INSERT INTO semaines (lundi, semaine_type_id) VALUES ($1, $2)
                 ON CONFLICT (lundi) DO UPDATE SET semaine_type_id = EXCLUDED.semaine_type_id, updated_at = CURRENT_TIMESTAMP`
            ),
            [lundi, type.id]
        );
    }

    for (const { seance } of annulees) {
        await db.run(`DELETE FROM waitlist_tokens WHERE seance_id = ?`, [seance.id]);
        await db.run(`DELETE FROM inscriptions WHERE seance_id = ?`, [seance.id]);
        await db.run(`UPDATE seances SET annulee = true, motif_annulation = ? WHERE id = ?`, [MOTIF_SEMAINE_TYPE, seance.id]);
    }
    for (const seance of aReactiver) {
        await db.run(`UPDATE seances SET annulee = false, motif_annulation = NULL WHERE id = ?`, [seance.id]);
    }

    // La génération suit le choix enregistré, ou à défaut la semaine type par défaut
    await seances.genererSemaine(db, lundi);

    return bilan;
};

// Semaines à venir qui suivent une semaine type (par choix ou par défaut)
const semainesSuivant = async (db, typeId) =>
    (await planning(db)).filter(s => String(s.semaine_type_id) === String(typeId));

// Change la semaine type par défaut, et la fait suivre aux semaines à venir
// qui n'ont pas de choix explicite. Renvoie les bilans de ces semaines.
const definirParDefaut = async (db, id) => {
    const type = await trouverType(db, id);
    if (!type) throw new ErreurSemaineType('Semaine type non trouvée', 404);

    const concernees = (await planning(db)).filter(s => !s.explicite);
    await db.run(`UPDATE semaines_types SET par_defaut = false WHERE id != ?`, [id]);
    await db.run(`UPDATE semaines_types SET par_defaut = true WHERE id = ?`, [id]);

    const bilans = [];
    for (const semaine of concernees) {
        bilans.push(await appliquerType(db, semaine.lundi, id, { explicite: false }));
    }
    return bilans;
};

// Remplace la sélection de créneaux d'une semaine type et répercute le
// changement sur les semaines à venir qui la suivent. Avec `simulation`,
// décrit seulement l'impact semaine par semaine.
const definirCreneaux = async (db, typeId, creneauIds, { simulation = false } = {}) => {
    const type = await trouverType(db, typeId);
    if (!type) throw new ErreurSemaineType('Semaine type non trouvée', 404);
    if (!Array.isArray(creneauIds)) throw new ErreurSemaineType('Liste de créneaux attendue');

    const ids = [...new Set(creneauIds.map(Number).filter(Number.isInteger))];
    if (ids.length > 0) {
        const connus = await db.get(
            `SELECT COUNT(*) AS n FROM creneaux WHERE id IN (${ids.map(() => '?').join(', ')})`,
            ids
        );
        if (parseInt(connus.n, 10) !== ids.length) throw new ErreurSemaineType('Créneau inconnu');
    }

    const semaines = await semainesSuivant(db, type.id);
    if (simulation) {
        const bilans = [];
        for (const semaine of semaines) {
            bilans.push(await appliquerType(db, semaine.lundi, type.id, { simulation: true, selection: ids }));
        }
        return bilans;
    }

    await db.run(`DELETE FROM semaine_type_creneaux WHERE semaine_type_id = ?`, [type.id]);
    for (const id of ids) {
        await db.run(`INSERT INTO semaine_type_creneaux (semaine_type_id, creneau_id) VALUES (?, ?)`, [type.id, id]);
    }

    const bilans = [];
    for (const semaine of semaines) {
        bilans.push(await appliquerType(db, semaine.lundi, type.id, { explicite: semaine.explicite }));
    }
    return bilans;
};

// Un nouveau créneau rejoint les semaines types indiquées ; les semaines à
// venir qui les suivent reçoivent sa séance.
const ajouterCreneauAuxTypes = async (db, creneauId, typeIds) => {
    for (const typeId of typeIds) {
        const type = await trouverType(db, typeId);
        if (!type) throw new ErreurSemaineType('Semaine type inconnue');
        await db.run(
            `INSERT INTO semaine_type_creneaux (semaine_type_id, creneau_id)
             SELECT ?, ? WHERE NOT EXISTS (
                 SELECT 1 FROM semaine_type_creneaux WHERE semaine_type_id = ? AND creneau_id = ?
             )`,
            [type.id, creneauId, type.id, creneauId]
        );
    }
};

module.exports = {
    MOTIF_SEMAINE_TYPE,
    ErreurSemaineType,
    migrer,
    fusionnerDoublons,
    typeParDefaut,
    trouverType,
    listerTypes,
    creneauxDuType,
    typeDeLaSemaine,
    planning,
    creerType,
    dupliquerType,
    renommerType,
    supprimerType,
    appliquerType,
    definirParDefaut,
    definirCreneaux,
    ajouterCreneauAuxTypes
};