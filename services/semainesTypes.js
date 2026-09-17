// services/semainesTypes.js

// Semaines types. Un club n'a pas le même planning en période scolaire et
// pendant les vacances : chaque créneau appartient à une semaine type, et
// chaque semaine du calendrier suit l'une d'elles — celle choisie par un
// admin, sinon la semaine type par défaut.

const seances = require('./seances');

const NOM_PAR_DEFAUT = 'Semaine standard';

// Motif d'annulation d'une séance retirée par un changement de semaine type :
// elle revit si la semaine revient à une semaine type qui la contient.
const MOTIF_SEMAINE_TYPE = 'semaine_type';

class ErreurSemaineType extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
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

// Idempotent. À lancer après la création des créneaux d'exemple : les créneaux
// sans semaine type sont rattachés à la semaine type par défaut.
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

    if (!(await colonneExiste(db, 'creneaux', 'semaine_type_id'))) {
        await db.run(`ALTER TABLE creneaux ADD COLUMN semaine_type_id INTEGER REFERENCES semaines_types (id)`);
        console.log('🔄 Colonne creneaux.semaine_type_id ajoutée');
    }
    if (!(await colonneExiste(db, 'seances', 'motif_annulation'))) {
        await db.run(`ALTER TABLE seances ADD COLUMN motif_annulation ${db.isPostgres ? 'VARCHAR(50)' : 'TEXT'}`);
        console.log('🔄 Colonne seances.motif_annulation ajoutée');
    }

    let defaut = await typeParDefaut(db);
    if (!defaut) {
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
        defaut = await typeParDefaut(db);
    }

    const rattaches = await db.run(`UPDATE creneaux SET semaine_type_id = ? WHERE semaine_type_id IS NULL`, [defaut.id]);
    if (rattaches.changes > 0) {
        console.log(`🔄 ${rattaches.changes} créneau(x) rattaché(s) à « ${defaut.nom} »`);
    }
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
            (SELECT COUNT(*) FROM creneaux c WHERE c.semaine_type_id = t.id AND c.actif = true) AS nb_creneaux
     FROM semaines_types t
     ORDER BY t.par_defaut DESC, t.nom`
)).map(normaliserType);

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

// Copie une semaine type : ses créneaux actifs et leur appartenance aux blocs
const dupliquerType = async (db, sourceId, nom) => {
    const source = await trouverType(db, sourceId);
    if (!source) throw new ErreurSemaineType('Semaine type non trouvée', 404);

    const copie = await creerType(db, nom);
    const creneaux = await db.query(`SELECT * FROM creneaux WHERE semaine_type_id = ? AND actif = true ORDER BY id`, [sourceId]);
    const colonnes = ['nom', 'sport_id', 'jour_semaine', 'heure_debut', 'heure_fin', 'capacite_max', 'sans_limite',
        'lieu', 'nombre_lignes', 'personnes_par_ligne', 'licences_autorisees', 'public_cible'];

    for (const creneau of creneaux) {
        const insertion = await db.run(
            db.adaptSQL(
                `INSERT INTO creneaux (${colonnes.join(', ')}, semaine_type_id) VALUES (${colonnes.map(() => '?').join(', ')}, ?)`,
                `INSERT INTO creneaux (${colonnes.join(', ')}, semaine_type_id) VALUES (${colonnes.map(() => '?').join(', ')}, ?) RETURNING id`
            ),
            [...colonnes.map(c => creneau[c] === undefined ? null : creneau[c]), copie.id]
        );
        const blocs = await db.query(`SELECT bloc_id FROM bloc_creneaux WHERE creneau_id = ?`, [creneau.id]);
        for (const { bloc_id } of blocs) {
            await db.run(`INSERT INTO bloc_creneaux (bloc_id, creneau_id) VALUES (?, ?)`, [bloc_id, insertion.lastID]);
        }
    }

    return { ...copie, nb_creneaux: creneaux.length };
};

const renommerType = async (db, id, nom) => {
    const resultat = await db.run(`UPDATE semaines_types SET nom = ? WHERE id = ?`, [nomValide(nom), id]);
    if (!resultat.changes) throw new ErreurSemaineType('Semaine type non trouvée', 404);
    return trouverType(db, id);
};

// Une semaine type encore utilisée (par défaut, créneaux, semaines à venir)
// ne peut pas disparaître.
const supprimerType = async (db, id) => {
    const type = await trouverType(db, id);
    if (!type) throw new ErreurSemaineType('Semaine type non trouvée', 404);
    if (type.par_defaut) {
        throw new ErreurSemaineType('La semaine type par défaut ne peut pas être supprimée : choisissez-en une autre par défaut d\'abord');
    }

    const creneaux = await db.get(`SELECT COUNT(*) AS n FROM creneaux WHERE semaine_type_id = ?`, [id]);
    if (parseInt(creneaux.n, 10) > 0) {
        throw new ErreurSemaineType(`Cette semaine type contient encore ${creneaux.n} créneau(x) : supprimez-les d'abord`);
    }

    const aVenir = await db.get(
        `SELECT COUNT(*) AS n FROM semaines WHERE semaine_type_id = ? AND lundi >= ?`,
        [id, seances.lundiDeLaSemaine(0)]
    );
    if (parseInt(aVenir.n, 10) > 0) {
        throw new ErreurSemaineType(`Cette semaine type est appliquée à ${aVenir.n} semaine(s) à venir : choisissez-en une autre pour ces semaines d'abord`);
    }

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

// Une séance d'une autre semaine type trouve son équivalent dans la nouvelle :
// même sport, même jour, mêmes horaires.
const correspond = (seance, creneau, lundi) =>
    String(seance.sport_id) === String(creneau.sport_id)
    && seance.date_seance === seances.dateDuJour(lundi, creneau.jour_semaine)
    && seance.heure_debut === creneau.heure_debut
    && seance.heure_fin === creneau.heure_fin;

// Fait suivre à une semaine la semaine type `typeId`, sans toucher aux jours
// passés :
// - une séance qui a son équivalent dans la semaine type est conservée avec
//   ses inscrits, et rattachée au créneau correspondant ;
// - les autres sont annulées et leurs inscrits désinscrits ;
// - les séances manquantes sont créées, celles annulées par un précédent
//   changement de semaine type sont rétablies.
//
// Avec `simulation`, rien n'est écrit : le résultat décrit l'impact.
// `explicite: false` applique la semaine type par défaut sans l'enregistrer
// comme un choix (la semaine suivra les prochains changements de défaut).
//
// Renvoie { conservees, creees, reactivees, annulees: [{ seance, inscrits }],
// seancesRattachees: [id] }.
const appliquerType = async (db, lundi, typeId, { simulation = false, explicite = true } = {}) => {
    lundiValide(lundi);
    const type = await trouverType(db, typeId);
    if (!type) throw new ErreurSemaineType('Semaine type non trouvée', 404);

    const dimanche = seances.ajouterJours(lundi, 6);
    const aujourdhui = seances.aujourdhuiIso();

    const seancesSemaine = (await db.query(
        `SELECT s.*, c.semaine_type_id AS type_creneau
         FROM seances s
         LEFT JOIN creneaux c ON c.id = s.creneau_id
         WHERE s.date_seance BETWEEN ? AND ?
         ORDER BY s.date_seance, s.heure_debut, s.id`,
        [lundi, dimanche]
    )).map(row => ({ ...row, date_seance: seances.normaliserDate(row.date_seance), annulee: seances.estVrai(row.annulee) }));

    const creneauxDuType = await db.query(
        `SELECT * FROM creneaux WHERE semaine_type_id = ? AND actif = true ORDER BY id`,
        [type.id]
    );

    const duType = (s) => String(s.type_creneau) === String(type.id);
    const aVenir = seancesSemaine.filter(s => s.date_seance >= aujourdhui);
    const dejaDuType = aVenir.filter(s => !s.annulee && duType(s));

    // Créneaux de la semaine type déjà pourvus d'une séance active cette semaine
    const pourvus = new Set(seancesSemaine.filter(s => !s.annulee && duType(s)).map(s => String(s.creneau_id)));

    // Les séances ponctuelles (sans créneau) ne dépendent d'aucune semaine type
    const rattachements = [];
    const aAnnuler = [];
    for (const seance of aVenir.filter(s => s.creneau_id && !s.annulee && !duType(s))) {
        const equivalent = creneauxDuType.find(c => !pourvus.has(String(c.id)) && correspond(seance, c, lundi));
        if (equivalent) {
            pourvus.add(String(equivalent.id));
            rattachements.push({ seance, creneau: equivalent });
        } else {
            aAnnuler.push(seance);
        }
    }

    const aReactiver = aVenir.filter(s => s.annulee && s.motif_annulation === MOTIF_SEMAINE_TYPE
        && duType(s) && !pourvus.has(String(s.creneau_id)));
    aReactiver.forEach(s => pourvus.add(String(s.creneau_id)));

    const dejaPresents = new Set(seancesSemaine.map(s => String(s.creneau_id)));
    const creees = creneauxDuType.filter(c => !pourvus.has(String(c.id)) && !dejaPresents.has(String(c.id))
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
        conservees: dejaDuType.length + rattachements.length,
        creees,
        reactivees: aReactiver.length,
        annulees,
        seancesRattachees: rattachements.map(r => r.seance.id)
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

    for (const { seance, creneau } of rattachements) {
        // Une ancienne séance annulée de ce créneau occuperait sa place (même date)
        const anciennes = seancesSemaine.filter(s => s.annulee && String(s.creneau_id) === String(creneau.id));
        for (const ancienne of anciennes) {
            await db.run(`DELETE FROM waitlist_tokens WHERE seance_id = ?`, [ancienne.id]);
            await db.run(`DELETE FROM inscriptions WHERE seance_id = ?`, [ancienne.id]);
            await db.run(`DELETE FROM seances WHERE id = ?`, [ancienne.id]);
        }
        await seances.rattacherAuCreneau(db, seance.id, creneau);
    }

    for (const seance of aReactiver) {
        await db.run(`UPDATE seances SET annulee = false, motif_annulation = NULL WHERE id = ?`, [seance.id]);
    }

    // La génération suit le choix enregistré, ou à défaut la semaine type par défaut
    await seances.genererSemaine(db, lundi);

    return bilan;
};
// Change la semaine type par défaut, et la fait suivre aux semaines à venir
// qui n'ont pas de choix explicite. Renvoie les bilans de ces semaines.
const definirParDefaut = async (db, id) => {
    const type = await trouverType(db, id);
    if (!type) throw new ErreurSemaineType('Semaine type non trouvée', 404);

    await db.run(`UPDATE semaines_types SET par_defaut = false WHERE id != ?`, [id]);
    await db.run(`UPDATE semaines_types SET par_defaut = true WHERE id = ?`, [id]);

    const bilans = [];
    for (const semaine of await planning(db)) {
        if (!semaine.explicite) {
            bilans.push(await appliquerType(db, semaine.lundi, id, { explicite: false }));
        }
    }
    return bilans;
};

module.exports = {
    MOTIF_SEMAINE_TYPE,
    ErreurSemaineType,
    migrer,
    typeParDefaut,
    trouverType,
    listerTypes,
    typeDeLaSemaine,
    planning,
    creerType,
    dupliquerType,
    renommerType,
    supprimerType,
    appliquerType,
    definirParDefaut
};