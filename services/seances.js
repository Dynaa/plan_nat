// services/seances.js

// Séances datées. Un créneau décrit une séance récurrente (« le lundi à 7h ») ;
// une séance en est l'occurrence d'une semaine précise. Chaque séance copie les
// réglages de son créneau à sa création : on peut ensuite l'ajuster sans
// toucher aux autres semaines. Les inscriptions pointent vers une séance.

// Nombre de semaines consultables, en partant de la semaine en cours
const SEMAINES_MEMBRES = 2;
const SEMAINES_ADMIN = 4;

// --- Dates ---------------------------------------------------------------
// Les dates circulent en chaînes « AAAA-MM-JJ ». Les calculs se font en UTC
// pour ne pas dépendre du fuseau du serveur ; seul « aujourd'hui » est pris
// à l'heure de Paris, celle du club.

const pad = (n) => String(n).padStart(2, '0');

const aujourdhuiIso = (maintenant = new Date()) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(maintenant);

// PostgreSQL renvoie les colonnes DATE en objets Date à minuit heure locale
const normaliserDate = (valeur) => {
    if (valeur instanceof Date) {
        return `${valeur.getFullYear()}-${pad(valeur.getMonth() + 1)}-${pad(valeur.getDate())}`;
    }
    return String(valeur ?? '').slice(0, 10);
};

const versDate = (iso) => new Date(`${iso}T00:00:00Z`);

const ajouterJours = (iso, jours) => {
    const date = versDate(iso);
    date.setUTCDate(date.getUTCDate() + jours);
    return date.toISOString().slice(0, 10);
};

// 0 = dimanche … 6 = samedi, comme creneaux.jour_semaine
const jourSemaineDe = (iso) => versDate(iso).getUTCDay();

// Lundi de la semaine contenant `iso`, décalé de `offset` semaines
const lundiDe = (iso, offset = 0) => {
    const jour = jourSemaineDe(iso) || 7; // dimanche = fin de semaine
    return ajouterJours(iso, 1 - jour + offset * 7);
};

const lundiDeLaSemaine = (offset = 0, reference = aujourdhuiIso()) => lundiDe(reference, offset);

const dateDuJour = (lundi, jourSemaine) => ajouterJours(lundi, (Number(jourSemaine) || 7) - 1);

const estVrai = (valeur) => valeur === true || valeur === 1 || valeur === '1' || valeur === 'true';

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

const ajouterColonne = async (db, table, colonne, type) => {
    if (await colonneExiste(db, table, colonne)) return;
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${type}`);
    console.log(`🔄 Colonne ${table}.${colonne} ajoutée`);
};

// Crée la table des séances et y rattache l'existant. Idempotent : sans effet
// quand tout est déjà en place. Les colonnes creneau_id et date_seance des
// inscriptions restent renseignées, si bien qu'une version antérieure de
// l'application fonctionne encore sur une base migrée.
const migrer = async (db) => {
    await db.run(db.adaptSQL(
        `CREATE TABLE IF NOT EXISTS seances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            creneau_id INTEGER,
            date_seance TEXT NOT NULL,
            nom TEXT NOT NULL,
            sport_id INTEGER,
            heure_debut TEXT NOT NULL,
            heure_fin TEXT NOT NULL,
            capacite_max INTEGER NOT NULL DEFAULT 0,
            sans_limite BOOLEAN DEFAULT 0,
            lieu TEXT,
            nombre_lignes INTEGER,
            personnes_par_ligne INTEGER,
            public_cible TEXT DEFAULT 'les deux',
            modifiee BOOLEAN DEFAULT 0,
            annulee BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (creneau_id) REFERENCES creneaux (id) ON DELETE SET NULL,
            FOREIGN KEY (sport_id) REFERENCES sports (id)
        )`,
        `CREATE TABLE IF NOT EXISTS seances (
            id SERIAL PRIMARY KEY,
            creneau_id INTEGER REFERENCES creneaux (id) ON DELETE SET NULL,
            date_seance DATE NOT NULL,
            nom VARCHAR(255) NOT NULL,
            sport_id INTEGER REFERENCES sports (id),
            heure_debut VARCHAR(10) NOT NULL,
            heure_fin VARCHAR(10) NOT NULL,
            capacite_max INTEGER NOT NULL DEFAULT 0,
            sans_limite BOOLEAN DEFAULT false,
            lieu VARCHAR(255),
            nombre_lignes INTEGER,
            personnes_par_ligne INTEGER,
            public_cible VARCHAR(50) DEFAULT 'les deux',
            modifiee BOOLEAN DEFAULT false,
            annulee BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
    ));
    // Une séance par créneau et par date. Les séances ponctuelles (sans
    // créneau) échappent à la contrainte : deux NULL n'entrent pas en conflit.
    await db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_seances_creneau_date ON seances (creneau_id, date_seance)`);
    await db.run(`CREATE INDEX IF NOT EXISTS idx_seances_date ON seances (date_seance)`);

    await ajouterColonne(db, 'inscriptions', 'seance_id', 'INTEGER REFERENCES seances (id)');
    await db.run(`CREATE INDEX IF NOT EXISTS idx_inscriptions_seance ON inscriptions (seance_id)`);
    await db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inscriptions_user_seance ON inscriptions (user_id, seance_id)`);

    // La date manquait aux jetons de liste d'attente : leur création échouait
    await ajouterColonne(db, 'waitlist_tokens', 'date_seance', db.isPostgres ? 'DATE' : 'TEXT');
    await ajouterColonne(db, 'waitlist_tokens', 'seance_id', 'INTEGER REFERENCES seances (id)');

    // Une séance pour chaque couple (créneau, date) déjà réservé
    const creees = await db.run(
        `INSERT INTO seances (creneau_id, date_seance, nom, sport_id, heure_debut, heure_fin,
                              capacite_max, sans_limite, lieu, nombre_lignes, personnes_par_ligne, public_cible)
         SELECT c.id, d.date_seance, c.nom, c.sport_id, c.heure_debut, c.heure_fin,
                COALESCE(c.capacite_max, c.nombre_lignes * c.personnes_par_ligne, 0),
                COALESCE(c.sans_limite, false), c.lieu, c.nombre_lignes, c.personnes_par_ligne,
                COALESCE(c.public_cible, 'les deux')
         FROM (SELECT DISTINCT creneau_id, date_seance FROM inscriptions WHERE seance_id IS NULL) d
         JOIN creneaux c ON c.id = d.creneau_id
         WHERE NOT EXISTS (
             SELECT 1 FROM seances s WHERE s.creneau_id = d.creneau_id AND s.date_seance = d.date_seance
         )`
    );
    if (creees.changes > 0) {
        console.log(`🔄 ${creees.changes} séance(s) créée(s) à partir des inscriptions existantes`);
    }

    const rattachees = await db.run(
        `UPDATE inscriptions SET seance_id = (
             SELECT s.id FROM seances s
             WHERE s.creneau_id = inscriptions.creneau_id AND s.date_seance = inscriptions.date_seance
         )
         WHERE seance_id IS NULL`
    );
    if (rattachees.changes > 0) {
        console.log(`🔄 ${rattachees.changes} inscription(s) rattachée(s) à leur séance`);
    }

    await db.run(
        `UPDATE waitlist_tokens SET seance_id = (
             SELECT s.id FROM seances s
             WHERE s.creneau_id = waitlist_tokens.creneau_id AND s.date_seance = waitlist_tokens.date_seance
         )
         WHERE seance_id IS NULL AND date_seance IS NOT NULL`
    );
};
// --- Séances ---------------------------------------------------------------

const capaciteDuCreneau = (c) =>
    parseInt(c.capacite_max, 10) || (parseInt(c.nombre_lignes, 10) * parseInt(c.personnes_par_ligne, 10)) || 0;

// Réglages recopiés d'un créneau vers ses séances
const COLONNES_REGLAGES = [
    'nom', 'sport_id', 'heure_debut', 'heure_fin', 'capacite_max', 'sans_limite',
    'lieu', 'nombre_lignes', 'personnes_par_ligne', 'public_cible'
];
const reglagesDuCreneau = (c) => [
    c.nom, c.sport_id, c.heure_debut, c.heure_fin, capaciteDuCreneau(c), estVrai(c.sans_limite),
    c.lieu || null, c.nombre_lignes || null, c.personnes_par_ligne || null, c.public_cible || 'les deux'
];

const normaliserSeance = (row) => {
    if (!row) return null;
    const date = normaliserDate(row.date_seance);
    return {
        ...row,
        date_seance: date,
        jour_semaine: jourSemaineDe(date),
        capacite_max: parseInt(row.capacite_max, 10) || 0,
        sans_limite: estVrai(row.sans_limite),
        modifiee: estVrai(row.modifiee),
        annulee: estVrai(row.annulee)
    };
};

// Crée les séances manquantes de la semaine commençant `lundi`, une par
// créneau actif de la semaine type qu'elle suit (choisie pour cette semaine,
// sinon celle par défaut). Une semaine où un créneau a déjà sa séance n'est
// pas retouchée, même si cette séance a été déplacée ou annulée.
const genererSemaine = async (db, lundi) => {
    const dimanche = ajouterJours(lundi, 6);
    const typeParDefaut = `(SELECT id FROM semaines_types WHERE par_defaut = true ORDER BY id LIMIT 1)`;
    const creneaux = await db.query(
        `SELECT c.* FROM creneaux c
         WHERE c.actif = true
           AND COALESCE(c.semaine_type_id, ${typeParDefaut}) = COALESCE(
               (SELECT semaine_type_id FROM semaines WHERE lundi = ?),
               ${typeParDefaut}
           )`,
        [lundi]
    );
    const existantes = await db.query(
        `SELECT creneau_id FROM seances WHERE creneau_id IS NOT NULL AND date_seance BETWEEN ? AND ?`,
        [lundi, dimanche]
    );
    const dejaGeneres = new Set(existantes.map(s => String(s.creneau_id)));

    const colonnes = ['creneau_id', 'date_seance', ...COLONNES_REGLAGES].join(', ');
    const marqueurs = Array(COLONNES_REGLAGES.length + 2).fill('?').join(', ');
    // Deux requêtes simultanées peuvent générer la même semaine : l'index
    // unique (créneau, date) départage sans erreur.
    const insertion = db.adaptSQL(
        `INSERT OR IGNORE INTO seances (${colonnes}) VALUES (${marqueurs})`,
        `INSERT INTO seances (${colonnes}) VALUES (${marqueurs}) ON CONFLICT (creneau_id, date_seance) DO NOTHING`
    );

    let creees = 0;
    for (const creneau of creneaux) {
        if (dejaGeneres.has(String(creneau.id))) continue;
        const resultat = await db.run(insertion, [
            creneau.id, dateDuJour(lundi, creneau.jour_semaine), ...reglagesDuCreneau(creneau)
        ]);
        creees += resultat.changes || 0;
    }
    return creees;
};

const genererSemaines = async (db, nombre) => {
    for (let offset = 0; offset < nombre; offset++) {
        await genererSemaine(db, lundiDeLaSemaine(offset));
    }
};

const SELECT_SEANCE = `
    SELECT s.*, sp.slug AS sport_slug, sp.nom AS sport_nom, sp.icone AS sport_icone,
           sp.couleur AS sport_couleur, sp.ordre AS sport_ordre
    FROM seances s
    LEFT JOIN sports sp ON sp.id = s.sport_id`;

// Séances d'une période, avec leur remplissage et leur éventuel bloc
const listerSeances = async (db, { debut, fin, publicCible = null, inclureAnnulees = false }) => {
    const filtres = [];
    if (publicCible === 'jeune' || publicCible === 'adulte') {
        filtres.push(`AND s.public_cible IN ('${publicCible}', 'les deux')`);
    }
    if (!inclureAnnulees) {
        filtres.push('AND s.annulee = false');
    }

    const rows = await db.query(
        `SELECT s.*, sp.slug AS sport_slug, sp.nom AS sport_nom, sp.icone AS sport_icone,
                sp.couleur AS sport_couleur, b.id AS bloc_id, b.nom AS bloc_nom,
                (SELECT COUNT(*) FROM inscriptions i WHERE i.seance_id = s.id AND i.statut = 'inscrit') AS inscrits,
                (SELECT COUNT(*) FROM inscriptions i WHERE i.seance_id = s.id AND i.statut = 'attente') AS en_attente
         FROM seances s
         LEFT JOIN sports sp ON sp.id = s.sport_id
         LEFT JOIN bloc_creneaux bc ON bc.creneau_id = s.creneau_id
         LEFT JOIN blocs b ON b.id = bc.bloc_id
         WHERE s.date_seance BETWEEN ? AND ? ${filtres.join(' ')}
         ORDER BY s.date_seance, s.heure_debut, sp.ordre, s.id`,
        [debut, fin]
    );

    const aujourdhui = aujourdhuiIso();
    return rows.map(row => {
        const seance = normaliserSeance(row);
        return {
            ...seance,
            inscrits: parseInt(row.inscrits, 10) || 0,
            en_attente: parseInt(row.en_attente, 10) || 0,
            est_passe: seance.date_seance < aujourdhui
        };
    });
};

// Blocs dans lesquels le membre a déjà une séance sur la période :
// bloc_id → { seance_id, nom }
const blocsOccupes = async (db, userId, debut, fin) => {
    const rows = await db.query(
        `SELECT bc.bloc_id, s.id AS seance_id, s.nom
         FROM inscriptions i
         JOIN seances s ON s.id = i.seance_id
         JOIN bloc_creneaux bc ON bc.creneau_id = s.creneau_id
         WHERE i.user_id = ? AND i.statut = 'inscrit' AND s.date_seance BETWEEN ? AND ?`,
        [userId, debut, fin]
    );
    return new Map(rows.map(r => [String(r.bloc_id), { seance_id: r.seance_id, nom: r.nom }]));
};

const trouverSeance = async (db, seanceId) =>
    normaliserSeance(await db.get(`${SELECT_SEANCE} WHERE s.id = ?`, [seanceId]));

// Séance d'un créneau à une date. Les semaines à venir sont générées au
// besoin : un ancien client peut encore désigner une séance ainsi.
const trouverSeanceParCreneau = async (db, creneauId, dateSeance) => {
    const date = normaliserDate(dateSeance);
    const chercher = async () => normaliserSeance(await db.get(
        `${SELECT_SEANCE} WHERE s.creneau_id = ? AND s.date_seance = ?`,
        [creneauId, date]
    ));

    let seance = await chercher();
    if (!seance && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= lundiDeLaSemaine(0)) {
        await genererSemaine(db, lundiDe(date));
        seance = await chercher();
    }
    return seance;
};

// Séance désignée par une requête : { seanceId } ou, pour les anciens
// clients, { creneauId, date_seance }
const resoudreSeance = async (db, { seanceId, creneauId, date_seance }) => {
    if (seanceId) return trouverSeance(db, seanceId);
    if (creneauId && date_seance) return trouverSeanceParCreneau(db, creneauId, date_seance);
    return null;
};

// Reporte les réglages d'un créneau sur ses séances à venir, sauf celles
// ajustées à la main. Un changement de jour déplace la séance dans sa
// semaine, inscriptions comprises. Renvoie les séances mises à jour.
const synchroniserCreneau = async (db, creneauId) => {
    const creneau = await db.get(`SELECT * FROM creneaux WHERE id = ?`, [creneauId]);
    if (!creneau) return [];

    const aVenir = await db.query(
        `SELECT id, date_seance FROM seances
         WHERE creneau_id = ? AND date_seance >= ? AND modifiee = false`,
        [creneauId, aujourdhuiIso()]
    );

    const miseAJour = `UPDATE seances SET ${COLONNES_REGLAGES.map(c => `${c} = ?`).join(', ')}, date_seance = ? WHERE id = ?`;
    for (const seance of aVenir) {
        const date = normaliserDate(seance.date_seance);
        const nouvelleDate = dateDuJour(lundiDe(date), creneau.jour_semaine);

        await db.run(miseAJour, [...reglagesDuCreneau(creneau), nouvelleDate, seance.id]);
        if (nouvelleDate !== date) {
            await db.run(`UPDATE inscriptions SET date_seance = ? WHERE seance_id = ?`, [nouvelleDate, seance.id]);
            await db.run(`UPDATE waitlist_tokens SET date_seance = ? WHERE seance_id = ?`, [nouvelleDate, seance.id]);
        }
    }
    return aVenir.map(s => s.id);
};

// Rattache une séance à un autre créneau (changement de semaine type) : elle
// en prend les réglages, sauf si elle a été ajustée à la main, et garde ses
// inscrits.
const rattacherAuCreneau = async (db, seanceId, creneau) => {
    const seance = await db.get(`SELECT modifiee FROM seances WHERE id = ?`, [seanceId]);
    if (estVrai(seance && seance.modifiee)) {
        await db.run(`UPDATE seances SET creneau_id = ? WHERE id = ?`, [creneau.id, seanceId]);
    } else {
        await db.run(
            `UPDATE seances SET creneau_id = ?, ${COLONNES_REGLAGES.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
            [creneau.id, ...reglagesDuCreneau(creneau), seanceId]
        );
    }
    await db.run(`UPDATE inscriptions SET creneau_id = ? WHERE seance_id = ?`, [creneau.id, seanceId]);
    await db.run(`UPDATE waitlist_tokens SET creneau_id = ? WHERE seance_id = ?`, [creneau.id, seanceId]);
};

// --- Inscriptions ----------------------------------------------------------

const compterInscrits = async (db, seanceId) => {
    const row = await db.get(
        `SELECT COUNT(*) AS total FROM inscriptions WHERE seance_id = ? AND statut = 'inscrit'`,
        [seanceId]
    );
    return parseInt(row && row.total, 10) || 0;
};

const prochainePositionAttente = async (db, seanceId) => {
    const row = await db.get(
        `SELECT COALESCE(MAX(position_attente), 0) + 1 AS position
         FROM inscriptions WHERE seance_id = ? AND statut = 'attente'`,
        [seanceId]
    );
    return parseInt(row && row.position, 10) || 1;
};

// Positions d'attente continues (1, 2, 3…) après un départ ou une promotion
const renumeroterAttente = async (db, seanceId) => {
    const enAttente = await db.query(
        `SELECT id FROM inscriptions WHERE seance_id = ? AND statut = 'attente'
         ORDER BY position_attente, created_at, id`,
        [seanceId]
    );
    for (const [index, inscription] of enAttente.entries()) {
        await db.run(`UPDATE inscriptions SET position_attente = ? WHERE id = ?`, [index + 1, inscription.id]);
    }
};

// Promotion directe de la liste d'attente quand des places sont gagnées
// (capacité augmentée, séance passée sans limite). Les séances passées ou
// annulées ne sont pas repourvues. Renvoie les membres promus.
const promouvoirSeance = async (db, seanceId) => {
    const seance = await trouverSeance(db, seanceId);
    if (!seance || seance.annulee || seance.date_seance < aujourdhuiIso()) {
        return { seance, promus: [] };
    }

    const placesLibres = seance.sans_limite
        ? Infinity
        : seance.capacite_max - await compterInscrits(db, seanceId);
    if (placesLibres <= 0) return { seance, promus: [] };

    const enAttente = await db.query(
        `SELECT id, user_id FROM inscriptions WHERE seance_id = ? AND statut = 'attente'
         ORDER BY position_attente, created_at, id`,
        [seanceId]
    );
    const aPromouvoir = enAttente.slice(0, placesLibres);

    for (const inscription of aPromouvoir) {
        await db.run(
            `UPDATE inscriptions SET statut = 'inscrit', position_attente = NULL WHERE id = ?`,
            [inscription.id]
        );
    }
    if (aPromouvoir.length > 0) await renumeroterAttente(db, seanceId);

    return { seance, promus: aPromouvoir.map(i => i.user_id) };
};

// Retire un membre d'une séance. `placeLiberee` indique qu'un inscrit
// (et non une personne en attente) est parti.
const retirerInscription = async (db, seanceId, userId) => {
    const inscription = await db.get(
        `SELECT * FROM inscriptions WHERE seance_id = ? AND user_id = ?`,
        [seanceId, userId]
    );
    if (!inscription) return null;

    await db.run(`DELETE FROM inscriptions WHERE id = ?`, [inscription.id]);
    if (inscription.statut === 'attente') await renumeroterAttente(db, seanceId);

    return { inscription, placeLiberee: inscription.statut === 'inscrit' };
};

module.exports = {
    SEMAINES_MEMBRES,
    SEMAINES_ADMIN,
    aujourdhuiIso,
    normaliserDate,
    ajouterJours,
    jourSemaineDe,
    lundiDe,
    lundiDeLaSemaine,
    dateDuJour,
    estVrai,
    migrer,
    genererSemaine,
    genererSemaines,
    listerSeances,
    blocsOccupes,
    trouverSeance,
    trouverSeanceParCreneau,
    resoudreSeance,
    synchroniserCreneau,
    rattacherAuCreneau,
    compterInscrits,
    prochainePositionAttente,
    renumeroterAttente,
    promouvoirSeance,
    retirerInscription
};