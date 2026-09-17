// Séances datées : migration, génération, synchronisation, liste d'attente.
// Tests sur une vraie base SQLite en mémoire (NODE_ENV=test), avec le schéma
// d'avant la migration.
const DatabaseAdapter = require('../../database');
const seances = require('../../services/seances');
const semainesTypes = require('../../services/semainesTypes');

// La génération des séances dépend des semaines types
// Semaines entièrement à venir : la génération ne crée rien dans le passé
const S1 = seances.lundiDeLaSemaine(1);
const S1_FIN = seances.ajouterJours(S1, 6);
const S2 = seances.lundiDeLaSemaine(2);
const S2_FIN = seances.ajouterJours(S2, 6);

const migrerTout = async (db) => {
    await seances.migrer(db);
    await semainesTypes.migrer(db);
};

const SCHEMA_INITIAL = [
    `CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, nom TEXT, prenom TEXT,
        licence_type TEXT DEFAULT 'Loisir/Senior', public_cible TEXT DEFAULT 'adulte')`,
    `CREATE TABLE sports (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, nom TEXT, icone TEXT,
        couleur TEXT, ordre INTEGER DEFAULT 0, actif BOOLEAN DEFAULT 1)`,
    `CREATE TABLE creneaux (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL, sport_id INTEGER,
        jour_semaine INTEGER NOT NULL, heure_debut TEXT NOT NULL, heure_fin TEXT NOT NULL,
        capacite_max INTEGER, sans_limite BOOLEAN DEFAULT 0, lieu TEXT, nombre_lignes INTEGER,
        personnes_par_ligne INTEGER, public_cible TEXT DEFAULT 'les deux', actif BOOLEAN DEFAULT 1)`,
    `CREATE TABLE inscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
        creneau_id INTEGER NOT NULL, date_seance TEXT NOT NULL, statut TEXT DEFAULT 'inscrit',
        position_attente INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, creneau_id, date_seance))`,
    `CREATE TABLE waitlist_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL, creneau_id INTEGER NOT NULL, expires_at DATETIME NOT NULL,
        used BOOLEAN DEFAULT 0)`,
    `CREATE TABLE blocs (id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT, sport_id INTEGER)`,
    `CREATE TABLE bloc_creneaux (bloc_id INTEGER, creneau_id INTEGER, PRIMARY KEY (bloc_id, creneau_id))`
];

const creerBase = async () => {
    const db = new DatabaseAdapter();
    for (const sql of SCHEMA_INITIAL) await db.run(sql);
    await db.run(`INSERT INTO sports (slug, nom, ordre) VALUES ('natation', 'Natation', 1), ('velo', 'Vélo', 2)`);
    for (let i = 1; i <= 4; i++) {
        await db.run(`INSERT INTO users (email, nom, prenom) VALUES (?, ?, ?)`, [`m${i}@x.fr`, `Nom${i}`, `P${i}`]);
    }
    return db;
};

const creerCreneau = async (db, champs = {}) => {
    const c = { nom: 'Lundi 7h', sport_id: 1, jour_semaine: 1, heure_debut: '07:00', heure_fin: '08:00',
        capacite_max: 2, sans_limite: 0, public_cible: 'les deux', ...champs };
    const res = await db.run(
        `INSERT INTO creneaux (nom, sport_id, jour_semaine, heure_debut, heure_fin, capacite_max, sans_limite, public_cible, nombre_lignes, personnes_par_ligne)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.nom, c.sport_id, c.jour_semaine, c.heure_debut, c.heure_fin, c.capacite_max, c.sans_limite,
            c.public_cible, c.nombre_lignes || null, c.personnes_par_ligne || null]
    );
    // Une fois les semaines types en place, le créneau rejoint celle par défaut
    const liaison = await db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'semaine_type_creneaux'`);
    if (liaison) {
        await db.run(
            `INSERT INTO semaine_type_creneaux (semaine_type_id, creneau_id) SELECT id, ? FROM semaines_types WHERE par_defaut = true`,
            [res.lastID]
        );
    }
    return res.lastID;
};

const inscrire = (db, userId, seance, statut = 'inscrit', position = null) => db.run(
    `INSERT INTO inscriptions (user_id, creneau_id, date_seance, seance_id, statut, position_attente)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, seance.creneau_id, seance.date_seance, seance.id, statut, position]
);

describe('Séances datées', () => {

    describe('dates', () => {
        it.each([
            ['2026-09-14', '2026-09-14'], // lundi
            ['2026-09-17', '2026-09-14'], // jeudi
            ['2026-09-20', '2026-09-14']  // dimanche : fin de la semaine, pas début de la suivante
        ])('le lundi de la semaine du %s est le %s', (date, lundi) => {
            expect(seances.lundiDe(date)).toBe(lundi);
        });

        it('décale de semaines entières, y compris au changement de mois', () => {
            expect(seances.lundiDe('2026-09-30', 1)).toBe('2026-10-05');
            expect(seances.lundiDe('2026-09-14', -1)).toBe('2026-09-07');
        });

        it('place le dimanche (0) en fin de semaine', () => {
            expect(seances.dateDuJour('2026-09-14', 1)).toBe('2026-09-14');
            expect(seances.dateDuJour('2026-09-14', 6)).toBe('2026-09-19');
            expect(seances.dateDuJour('2026-09-14', 0)).toBe('2026-09-20');
        });

        it("prend « aujourd'hui » à l'heure de Paris", () => {
            // 23h30 UTC le 14 = 1h30 le 15 à Paris (heure d'été)
            expect(seances.aujourdhuiIso(new Date('2026-09-14T23:30:00Z'))).toBe('2026-09-15');
        });

        it('normalise les dates renvoyées par PostgreSQL', () => {
            expect(seances.normaliserDate(new Date(2026, 8, 14))).toBe('2026-09-14');
            expect(seances.normaliserDate('2026-09-14T00:00:00.000Z')).toBe('2026-09-14');
        });
    });

    describe('migration', () => {
        let db;
        beforeEach(async () => { db = await creerBase(); });

        it("rattache chaque inscription existante à une séance créée d'après son créneau", async () => {
            const lundi = await creerCreneau(db, { nom: 'Lundi 7h', capacite_max: null, nombre_lignes: 2, personnes_par_ligne: 6 });
            await db.run(`INSERT INTO inscriptions (user_id, creneau_id, date_seance) VALUES (1, ?, '2026-09-07'), (2, ?, '2026-09-07'), (1, ?, '2026-09-14')`,
                [lundi, lundi, lundi]);
            await db.run(`INSERT INTO waitlist_tokens (token, user_id, creneau_id, expires_at) VALUES ('t', 1, ?, '2099-01-01')`, [lundi]);

            await migrerTout(db);

            const lignes = await db.query(`SELECT id, creneau_id, date_seance, nom, capacite_max FROM seances ORDER BY date_seance`);
            expect(lignes).toEqual([
                { id: expect.any(Number), creneau_id: lundi, date_seance: '2026-09-07', nom: 'Lundi 7h', capacite_max: 12 },
                { id: expect.any(Number), creneau_id: lundi, date_seance: '2026-09-14', nom: 'Lundi 7h', capacite_max: 12 }
            ]);
            const orphelines = await db.get(`SELECT COUNT(*) AS n FROM inscriptions WHERE seance_id IS NULL`);
            expect(orphelines.n).toBe(0);
            const rattachement = await db.query(`SELECT i.date_seance, s.date_seance AS date_s FROM inscriptions i JOIN seances s ON s.id = i.seance_id`);
            rattachement.forEach(r => expect(r.date_s).toBe(r.date_seance));
        });

        it('est sans effet si on la relance', async () => {
            const lundi = await creerCreneau(db);
            await db.run(`INSERT INTO inscriptions (user_id, creneau_id, date_seance) VALUES (1, ?, '2026-09-07')`, [lundi]);

            await migrerTout(db);
            await migrerTout(db);

            expect((await db.get(`SELECT COUNT(*) AS n FROM seances`)).n).toBe(1);
        });

        it('interdit deux inscriptions du même membre à la même séance', async () => {
            await creerCreneau(db);
            await migrerTout(db);
            await seances.genererSemaine(db, S1);
            const [seance] = await seances.listerSeances(db, { debut: S1, fin: S1_FIN });

            await inscrire(db, 1, seance);
            await expect(db.run(`INSERT INTO inscriptions (user_id, creneau_id, date_seance, seance_id) VALUES (1, 999, '2026-01-01', ?)`, [seance.id]))
                .rejects.toThrow(/UNIQUE/);
        });
    });

    describe('génération et liste', () => {
        let db;
        beforeEach(async () => {
            db = await creerBase();
            await migrerTout(db);
        });

        it('crée une séance par créneau actif, au bon jour, avec ses réglages', async () => {
            await creerCreneau(db, { nom: 'Mercredi', jour_semaine: 3, lieu: 'Piscine' });
            await creerCreneau(db, { nom: 'Dimanche vélo', jour_semaine: 0, sport_id: 2, sans_limite: 1, capacite_max: 0 });
            await creerCreneau(db, { nom: 'Inactif', jour_semaine: 2 });
            await db.run(`UPDATE creneaux SET actif = 0 WHERE nom = 'Inactif'`);

            expect(await seances.genererSemaine(db, S1)).toBe(2);
            const liste = await seances.listerSeances(db, { debut: S1, fin: S1_FIN });

            expect(liste.map(s => [s.nom, s.date_seance, s.jour_semaine])).toEqual([
                ['Mercredi', seances.ajouterJours(S1, 2), 3],
                ['Dimanche vélo', S1_FIN, 0]
            ]);
            expect(liste[1]).toMatchObject({ sans_limite: true, sport_nom: 'Vélo', inscrits: 0, en_attente: 0 });
        });

        it('ne crée aucune séance pour un jour déjà passé', async () => {
            for (const jour of [1, 2, 3, 4, 5, 6, 0]) {
                await creerCreneau(db, { nom: `Jour ${jour}`, jour_semaine: jour });
            }

            expect(await seances.genererSemaine(db, seances.lundiDeLaSemaine(-1))).toBe(0);

            // Semaine en cours : seulement d'aujourd'hui à dimanche
            const lundi = seances.lundiDeLaSemaine(0);
            const joursRestants = [0, 1, 2, 3, 4, 5, 6]
                .map(i => seances.ajouterJours(lundi, i))
                .filter(date => date >= seances.aujourdhuiIso());
            expect(await seances.genererSemaine(db, lundi)).toBe(joursRestants.length);
            const liste = await seances.listerSeances(db, { debut: lundi, fin: seances.ajouterJours(lundi, 6) });
            expect(liste.map(s => s.date_seance)).toEqual(joursRestants);
        });

        it('ne recrée pas une séance déjà présente dans la semaine, même déplacée', async () => {
            await creerCreneau(db);
            await seances.genererSemaine(db, S1);
            await db.run(`UPDATE seances SET date_seance = ?, modifiee = 1`, [seances.ajouterJours(S1, 1)]);

            expect(await seances.genererSemaine(db, S1)).toBe(0);
            expect((await db.get(`SELECT COUNT(*) AS n FROM seances`)).n).toBe(1);
        });

        it('compte inscrits et attente, et filtre public et séances annulées', async () => {
            await creerCreneau(db, { nom: 'Adultes', public_cible: 'adulte' });
            await creerCreneau(db, { nom: 'Jeunes', public_cible: 'jeune', heure_debut: '08:00' });
            await seances.genererSemaine(db, S1);
            const [adultes, jeunes] = await seances.listerSeances(db, { debut: S1, fin: S1_FIN });
            await inscrire(db, 1, adultes);
            await inscrire(db, 2, adultes, 'attente', 1);

            const pourJeunes = await seances.listerSeances(db, { debut: S1, fin: S1_FIN, publicCible: 'jeune' });
            expect(pourJeunes.map(s => s.nom)).toEqual(['Jeunes']);

            const tous = await seances.listerSeances(db, { debut: S1, fin: S1_FIN });
            expect(tous[0]).toMatchObject({ nom: 'Adultes', inscrits: 1, en_attente: 1 });

            await db.run(`UPDATE seances SET annulee = 1 WHERE id = ?`, [jeunes.id]);
            expect((await seances.listerSeances(db, { debut: S1, fin: S1_FIN })).map(s => s.nom)).toEqual(['Adultes']);
            expect(await seances.listerSeances(db, { debut: S1, fin: S1_FIN, inclureAnnulees: true })).toHaveLength(2);
        });

        it('retrouve la séance désignée par un ancien client (créneau + date)', async () => {
            const creneau = await creerCreneau(db, { jour_semaine: 4 });
            const jeudiProchain = seances.dateDuJour(seances.lundiDeLaSemaine(1), 4);

            const seance = await seances.resoudreSeance(db, { creneauId: creneau, date_seance: jeudiProchain });

            expect(seance).toMatchObject({ creneau_id: creneau, date_seance: jeudiProchain });
            expect(await seances.resoudreSeance(db, { seanceId: seance.id })).toMatchObject({ id: seance.id });
            expect(await seances.resoudreSeance(db, { creneauId: creneau, date_seance: seances.ajouterJours(jeudiProchain, 1) })).toBeNull();
            expect(await seances.resoudreSeance(db, {})).toBeNull();
        });

        it('situe les blocs déjà utilisés par un membre dans la semaine', async () => {
            const c1 = await creerCreneau(db, { nom: 'Lundi' });
            await creerCreneau(db, { nom: 'Mardi', jour_semaine: 2 });
            await db.run(`INSERT INTO blocs (nom) VALUES ('Début de semaine')`);
            await db.run(`INSERT INTO bloc_creneaux (bloc_id, creneau_id) VALUES (1, ?)`, [c1]);
            await seances.genererSemaine(db, S1);
            await seances.genererSemaine(db, S2);
            const [lundi] = await seances.listerSeances(db, { debut: S1, fin: S1_FIN });
            await inscrire(db, 1, lundi);

            expect((await seances.blocsOccupes(db, 1, S1, S1_FIN)).get('1')).toEqual({ seance_id: lundi.id, nom: 'Lundi' });
            expect((await seances.blocsOccupes(db, 1, S2, S2_FIN)).size).toBe(0);
        });
    });

    describe('synchronisation avec le créneau', () => {
        let db;
        beforeEach(async () => {
            db = await creerBase();
            await migrerTout(db);
        });

        it('reporte les réglages sur les séances à venir non ajustées, et déplace le jour avec ses inscrits', async () => {
            const creneau = await creerCreneau(db, { jour_semaine: 1 });
            const lundiPasse = seances.lundiDeLaSemaine(-1);
            const lundiSuivant = seances.lundiDeLaSemaine(1);
            const lundiDApres = seances.lundiDeLaSemaine(2);
            for (const l of [lundiSuivant, lundiDApres]) await seances.genererSemaine(db, l);
            // Séance ayant déjà eu lieu (la génération ne crée rien dans le passé)
            await db.run(
                `INSERT INTO seances (creneau_id, date_seance, nom, sport_id, heure_debut, heure_fin, capacite_max)
                 VALUES (?, ?, 'Lundi 7h', 1, '07:00', '08:00', 2)`,
                [creneau, lundiPasse]
            );
            const suivante = await seances.trouverSeanceParCreneau(db, creneau, lundiSuivant);
            await inscrire(db, 1, suivante);
            await db.run(`UPDATE seances SET modifiee = 1, nom = 'Ajustée' WHERE date_seance = ?`, [lundiDApres]);

            await db.run(`UPDATE creneaux SET nom = 'Mercredi 7h', jour_semaine = 3, capacite_max = 10 WHERE id = ?`, [creneau]);
            const majs = await seances.synchroniserCreneau(db, creneau);

            expect(majs).toEqual([suivante.id]);
            const apres = await seances.trouverSeance(db, suivante.id);
            expect(apres).toMatchObject({ nom: 'Mercredi 7h', capacite_max: 10, date_seance: seances.ajouterJours(lundiSuivant, 2) });
            const inscription = await db.get(`SELECT date_seance FROM inscriptions WHERE seance_id = ?`, [suivante.id]);
            expect(inscription.date_seance).toBe(apres.date_seance);

            const passee = await seances.trouverSeanceParCreneau(db, creneau, lundiPasse);
            expect(passee.nom).toBe('Lundi 7h');
            expect((await db.get(`SELECT nom FROM seances WHERE date_seance = ?`, [lundiDApres])).nom).toBe('Ajustée');
        });
    });

    describe("liste d'attente", () => {
        let db, seance;
        beforeEach(async () => {
            db = await creerBase();
            await migrerTout(db);
            await creerCreneau(db, { jour_semaine: 0, capacite_max: 1 }); // dimanche : toujours à venir cette semaine
            await seances.genererSemaine(db, seances.lundiDeLaSemaine(0));
            [seance] = await seances.listerSeances(db, { debut: seances.lundiDeLaSemaine(0), fin: seances.ajouterJours(seances.lundiDeLaSemaine(0), 6) });
            await inscrire(db, 1, seance);
            await inscrire(db, 2, seance, 'attente', 1);
            await inscrire(db, 3, seance, 'attente', 2);
            await inscrire(db, 4, seance, 'attente', 3);
        });

        const statuts = async () => db.query(`SELECT user_id, statut, position_attente FROM inscriptions WHERE seance_id = ? ORDER BY user_id`, [seance.id]);

        it('compte les inscrits et donne la prochaine position', async () => {
            expect(await seances.compterInscrits(db, seance.id)).toBe(1);
            expect(await seances.prochainePositionAttente(db, seance.id)).toBe(4);
        });

        it('promeut dans l\'ordre autant de membres que de places gagnées', async () => {
            await db.run(`UPDATE seances SET capacite_max = 3 WHERE id = ?`, [seance.id]);

            const { promus } = await seances.promouvoirSeance(db, seance.id);

            expect(promus).toEqual([2, 3]);
            expect(await statuts()).toEqual([
                { user_id: 1, statut: 'inscrit', position_attente: null },
                { user_id: 2, statut: 'inscrit', position_attente: null },
                { user_id: 3, statut: 'inscrit', position_attente: null },
                { user_id: 4, statut: 'attente', position_attente: 1 }
            ]);
        });

        it('promeut toute la liste quand la séance passe sans limite', async () => {
            await db.run(`UPDATE seances SET sans_limite = 1 WHERE id = ?`, [seance.id]);
            expect((await seances.promouvoirSeance(db, seance.id)).promus).toEqual([2, 3, 4]);
        });

        it('ne promeut personne sur une séance complète, annulée ou passée', async () => {
            expect((await seances.promouvoirSeance(db, seance.id)).promus).toEqual([]);

            await db.run(`UPDATE seances SET capacite_max = 5, annulee = 1 WHERE id = ?`, [seance.id]);
            expect((await seances.promouvoirSeance(db, seance.id)).promus).toEqual([]);

            await db.run(`UPDATE seances SET annulee = 0, date_seance = '2020-01-05' WHERE id = ?`, [seance.id]);
            expect((await seances.promouvoirSeance(db, seance.id)).promus).toEqual([]);
        });

        it('renumérote la liste quand une personne en attente se retire', async () => {
            const retrait = await seances.retirerInscription(db, seance.id, 2);

            expect(retrait.placeLiberee).toBe(false);
            expect((await statuts()).map(s => s.position_attente)).toEqual([null, 1, 2]);
        });

        it("signale la place libérée par le départ d'un inscrit", async () => {
            expect((await seances.retirerInscription(db, seance.id, 1)).placeLiberee).toBe(true);
            expect(await seances.retirerInscription(db, seance.id, 1)).toBeNull();
        });
    });
});