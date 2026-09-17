// Semaines types et bibliothèque de créneaux partagés : parcours complets
// sur le vrai serveur et une base SQLite en mémoire. Seuls la session et
// l'envoi d'emails sont simulés.
const request = require('supertest');

jest.mock('nodemailer', () => ({
    createTransport: jest.fn(() => ({
        sendMail: jest.fn().mockResolvedValue({ messageId: '123' }),
        verify: jest.fn().mockResolvedValue(true)
    })),
    createTestAccount: jest.fn().mockResolvedValue({ user: 'test', pass: 'pass' }),
    getTestMessageUrl: jest.fn(() => null)
}));

jest.mock('resend', () => ({ Resend: jest.fn() }));

const mockSession = {};
jest.mock('express-session', () => () => (req, res, next) => {
    req.session = mockSession;
    next();
});

const app = require('../../server');
const seances = require('../../services/seances');
const semainesTypes = require('../../services/semainesTypes');

const db = app.locals.db;
let natation, velo, standard;
let admin, anne, bruno, chloe;

const LUNDI_1 = () => seances.lundiDeLaSemaine(1);
const LUNDI_2 = () => seances.lundiDeLaSemaine(2);

const connecter = (user) => {
    mockSession.userId = user.id;
    mockSession.userRole = user.role;
};

const creerMembre = async (email) => {
    const res = await db.run(
        `INSERT INTO users (email, password, nom, prenom, licence_type, public_cible) VALUES (?, 'x', 'Nom', ?, 'Compétition', 'adulte')`,
        [email, email.split('@')[0]]
    );
    return { id: res.lastID, email, role: 'membre' };
};

const creerType = async (nom) => (await db.run(`INSERT INTO semaines_types (nom, par_defaut) VALUES (?, 0)`, [nom])).lastID;

// Créneau de la bibliothèque, sélectionné par les semaines types indiquées
const creerCreneau = async (typeIds, champs = {}) => {
    const c = { nom: 'Créneau', sport_id: natation, jour_semaine: 1, heure_debut: '07:00', heure_fin: '08:00',
        capacite_max: 5, ...champs };
    const id = (await db.run(
        `INSERT INTO creneaux (nom, sport_id, jour_semaine, heure_debut, heure_fin, capacite_max, public_cible, semaine_type_id)
         VALUES (?, ?, ?, ?, ?, ?, 'les deux', ?)`,
        [c.nom, c.sport_id, c.jour_semaine, c.heure_debut, c.heure_fin, c.capacite_max, c.semaine_type_id ?? null]
    )).lastID;
    for (const typeId of [].concat(typeIds)) {
        await db.run(`INSERT INTO semaine_type_creneaux (semaine_type_id, creneau_id) VALUES (?, ?)`, [typeId, id]);
    }
    return id;
};

const seancesDeLaSemaine = async (lundi, { inclureAnnulees = true } = {}) =>
    seances.listerSeances(db, { debut: lundi, fin: seances.ajouterJours(lundi, 6), inclureAnnulees });

const resume = (liste) => liste.map(s => `${s.nom}${s.annulee ? ' (annulée)' : ''}`);

const inscrire = async (membre, seanceId) => {
    connecter(membre);
    const res = await request(app).post('/api/inscriptions').send({ seanceId });
    connecter(admin);
    return res;
};

const appliquer = (lundi, typeId, simulation = false) =>
    request(app).post(`/api/admin/semaines/${lundi}`).send({ semaine_type_id: typeId, simulation });

const choisirCreneaux = (typeId, ids, simulation = false) =>
    request(app).put(`/api/admin/semaines-types/${typeId}/creneaux`).send({ creneau_ids: ids, simulation });

const TABLES = ['inscriptions', 'waitlist_tokens', 'seances', 'bloc_creneaux', 'blocs', 'semaine_type_creneaux', 'creneaux', 'semaines'];

beforeAll(async () => {
    await app.locals.dbPrete;
    natation = (await db.get(`SELECT id FROM sports WHERE slug = 'natation'`)).id;
    velo = (await db.get(`SELECT id FROM sports WHERE slug = 'velo'`)).id;
    admin = { ...(await db.get(`SELECT id, role FROM users WHERE role = 'admin' LIMIT 1`)) };
    anne = await creerMembre('anne@x.fr');
    bruno = await creerMembre('bruno@x.fr');
    chloe = await creerMembre('chloe@x.fr');
});

beforeEach(async () => {
    for (const table of TABLES) await db.run(`DELETE FROM ${table}`);
    await db.run(`DELETE FROM semaines_types WHERE par_defaut = 0`);
    standard = (await semainesTypes.typeParDefaut(db)).id;
    connecter(admin);
});

describe('reprise des créneaux existants', () => {

    it('rattache chaque créneau à sa semaine type d\'origine, une seule fois', async () => {
        const vacances = await creerType('Vacances');
        const sansType = await creerCreneau([], { nom: 'Ancien' });
        const deVacances = await creerCreneau([], { nom: 'Vacances', semaine_type_id: vacances, heure_debut: '09:00' });
        await db.run(`DELETE FROM migrations_appliquees WHERE nom = 'creneaux_partages_entre_semaines_types'`);

        await semainesTypes.migrer(db);
        // Un créneau ajouté ensuite à la seule bibliothèque n'est pas rattaché d'office
        const bibliotheque = await creerCreneau([], { nom: 'Bibliothèque', heure_debut: '10:00' });
        await semainesTypes.migrer(db);

        const liens = await db.query(`SELECT creneau_id, semaine_type_id FROM semaine_type_creneaux ORDER BY creneau_id`);
        expect(liens).toEqual([
            { creneau_id: sansType, semaine_type_id: standard },
            { creneau_id: deVacances, semaine_type_id: vacances }
        ]);
        expect(liens.some(l => l.creneau_id === bibliotheque)).toBe(false);
    });

    it('fusionne les copies identiques et regroupe leurs séances et inscrits', async () => {
        const vacances = await creerType('Vacances');
        const original = await creerCreneau([standard], { nom: 'Lundi' });
        const copie = await creerCreneau([vacances], { nom: 'Lundi' });
        const different = await creerCreneau([vacances], { nom: 'Lundi', capacite_max: 8 });

        // Semaine 1 : séance du créneau original ; semaine 2 : séance de la copie
        await seances.genererSemaine(db, LUNDI_1());
        await db.run(`INSERT INTO semaines (lundi, semaine_type_id) VALUES (?, ?)`, [LUNDI_2(), vacances]);
        await seances.genererSemaine(db, LUNDI_2());
        const [s1] = (await seancesDeLaSemaine(LUNDI_1())).filter(s => s.creneau_id === original);
        const s2 = (await seancesDeLaSemaine(LUNDI_2())).find(s => s.creneau_id === copie);
        // Semaine 2 : hors de la fenêtre des membres, l'inscription passe par la base
        await db.run(`INSERT INTO inscriptions (user_id, creneau_id, seance_id, date_seance) VALUES (?, ?, ?, ?)`,
            [anne.id, copie, s2.id, s2.date_seance]);
        // Même date pour les deux : une séance annulée de la copie doublonne celle de l'original
        await db.run(
            `INSERT INTO seances (creneau_id, date_seance, nom, sport_id, heure_debut, heure_fin, capacite_max, annulee, motif_annulation)
             VALUES (?, ?, 'Lundi', ?, '07:00', '08:00', 5, 1, 'semaine_type')`,
            [copie, s1.date_seance, natation]
        );

        await semainesTypes.fusionnerDoublons(db);

        const creneaux = (await db.query(`SELECT id FROM creneaux ORDER BY id`)).map(c => c.id);
        expect(creneaux).toEqual([original, different]);
        const liens = await db.query(`SELECT semaine_type_id FROM semaine_type_creneaux WHERE creneau_id = ? ORDER BY semaine_type_id`, [original]);
        expect(liens.map(l => l.semaine_type_id)).toEqual([standard, vacances]);

        const seancesOriginal = await db.query(`SELECT id, date_seance, annulee FROM seances WHERE creneau_id = ? ORDER BY date_seance`, [original]);
        expect(seancesOriginal.map(s => [s.id, s.annulee])).toEqual([[s1.id, 0], [s2.id, 0]]);
        expect(await db.query(`SELECT creneau_id, seance_id FROM inscriptions`)).toEqual([{ creneau_id: original, seance_id: s2.id }]);
    });

    it('fusionne deux séances actives à la même date en gardant tous les inscrits', async () => {
        const vacances = await creerType('Vacances');
        const original = await creerCreneau([standard], { nom: 'Lundi' });
        const copie = await creerCreneau([vacances], { nom: 'Lundi' });
        await seances.genererSemaine(db, LUNDI_1());
        const s1 = (await seancesDeLaSemaine(LUNDI_1()))[0];
        const s2 = (await db.run(
            `INSERT INTO seances (creneau_id, date_seance, nom, sport_id, heure_debut, heure_fin, capacite_max)
             VALUES (?, ?, 'Lundi', ?, '07:00', '08:00', 5)`,
            [copie, s1.date_seance, natation]
        )).lastID;
        // À égalité (deux inscrits chacune), la séance la plus ancienne l'emporte
        await inscrire(anne, s1.id);
        await inscrire(bruno, s1.id);
        await inscrire(anne, s2); // doublon : un seul restera
        await inscrire(chloe, s2); // rejoint la séance gardée

        await semainesTypes.fusionnerDoublons(db);

        expect((await db.query(`SELECT id, creneau_id FROM seances`))).toEqual([{ id: s1.id, creneau_id: original }]);
        const inscrits = await db.query(`SELECT user_id, creneau_id FROM inscriptions WHERE seance_id = ? ORDER BY user_id`, [s1.id]);
        expect(inscrits).toEqual([anne, bruno, chloe].map(m => ({ user_id: m.id, creneau_id: original })));
        expect((await db.get(`SELECT COUNT(*) AS n FROM inscriptions`)).n).toBe(3);
    });

    it('ne fusionne pas des créneaux rangés dans des blocs différents', async () => {
        const a = await creerCreneau([standard], { nom: 'Lundi' });
        const b = await creerCreneau([standard], { nom: 'Lundi' });
        const bloc = (await db.run(`INSERT INTO blocs (nom, sport_id) VALUES ('Début', ?)`, [natation])).lastID;
        await db.run(`INSERT INTO bloc_creneaux (bloc_id, creneau_id) VALUES (?, ?)`, [bloc, a]);

        await semainesTypes.fusionnerDoublons(db);

        expect((await db.query(`SELECT id FROM creneaux ORDER BY id`)).map(c => c.id)).toEqual([a, b]);
    });
});

describe('bibliothèque de créneaux', () => {

    it('crée un créneau dans les semaines types demandées, ou dans la seule bibliothèque', async () => {
        const vacances = await creerType('Vacances');
        const base = { nom: 'Nouveau', sport_id: velo, jour_semaine: 3, heure_debut: '18:00', heure_fin: '19:00', capacite_max: 8 };

        const partage = await request(app).post('/api/creneaux').send({ ...base, semaine_type_ids: [standard, vacances] });
        const seul = await request(app).post('/api/creneaux').send({ ...base, nom: 'Réserve' });
        expect((await request(app).post('/api/creneaux').send({ ...base, semaine_type_ids: [999999] })).status).toBe(400);

        const bibliotheque = await request(app).get('/api/creneaux');
        expect(bibliotheque.body.map(c => [c.nom, c.semaines_types.map(t => t.nom)])).toEqual([
            ['Nouveau', ['Semaine standard', 'Vacances']],
            ['Réserve', []]
        ]);
        const deVacances = await request(app).get(`/api/creneaux?semaine_type=${vacances}`);
        expect(deVacances.body.map(c => c.id)).toEqual([partage.body.creneauId]);

        // Seul le créneau sélectionné donne une séance
        await seances.genererSemaine(db, LUNDI_1());
        expect(resume(await seancesDeLaSemaine(LUNDI_1()))).toEqual(['Nouveau']);
        expect(seul.body.creneauId).toEqual(expect.any(Number));
    });

    it('répercute la modification d\'un créneau partagé sur toutes ses semaines types', async () => {
        const vacances = await creerType('Vacances');
        const creneau = await creerCreneau([standard, vacances], { nom: 'Lundi' });
        await db.run(`INSERT INTO semaines (lundi, semaine_type_id) VALUES (?, ?)`, [LUNDI_2(), vacances]);
        await seances.genererSemaine(db, LUNDI_1());
        await seances.genererSemaine(db, LUNDI_2());

        await request(app).put(`/api/creneaux/${creneau}`).send({
            nom: 'Lundi renommé', sport_id: natation, jour_semaine: 1, heure_debut: '07:00', heure_fin: '08:00', capacite_max: 5
        });

        expect(resume(await seancesDeLaSemaine(LUNDI_1()))).toEqual(['Lundi renommé']);
        expect(resume(await seancesDeLaSemaine(LUNDI_2()))).toEqual(['Lundi renommé']);
    });

    it('supprime un créneau de la bibliothèque avec ses liens', async () => {
        const creneau = await creerCreneau([standard]);
        expect((await request(app).delete(`/api/creneaux/${creneau}`)).status).toBe(200);
        expect(await db.query(`SELECT * FROM semaine_type_creneaux`)).toEqual([]);
    });
});

describe('gestion des semaines types', () => {

    it('crée, renomme et liste les semaines types, la semaine par défaut en tête', async () => {
        const creation = await request(app).post('/api/admin/semaines-types').send({ nom: '  Zénith  ' });
        expect(creation.body.semaine_type).toMatchObject({ nom: 'Zénith', par_defaut: false });
        expect((await request(app).post('/api/admin/semaines-types').send({ nom: ' ' })).status).toBe(400);

        const renommage = await request(app).put(`/api/admin/semaines-types/${creation.body.semaine_type.id}`).send({ nom: 'Vacances' });
        expect(renommage.body.semaine_type.nom).toBe('Vacances');
        expect((await request(app).put('/api/admin/semaines-types/999999').send({ nom: 'X' })).status).toBe(404);

        await creerCreneau([standard]);
        const liste = await request(app).get('/api/admin/semaines-types');
        expect(liste.body.map(t => [t.nom, t.nb_creneaux])).toEqual([['Semaine standard', 1], ['Vacances', 0]]);
    });

    it('duplique une semaine type en partageant ses créneaux', async () => {
        const lundi = await creerCreneau([standard], { nom: 'Lundi' });
        const mardi = await creerCreneau([standard], { nom: 'Mardi', jour_semaine: 2 });

        const res = await request(app).post('/api/admin/semaines-types').send({ nom: 'Vacances', source_id: standard });

        expect(res.body.message).toContain('2 créneau(x)');
        expect((await db.get(`SELECT COUNT(*) AS n FROM creneaux`)).n).toBe(2);
        expect(await semainesTypes.creneauxDuType(db, res.body.semaine_type.id)).toEqual(expect.arrayContaining([lundi, mardi]));
    });

    it('supprime une semaine type sans toucher à ses créneaux, sauf si elle est encore en service', async () => {
        expect((await request(app).delete(`/api/admin/semaines-types/${standard}`)).body.error).toContain('par défaut');

        const planifiee = await creerType('Planifiée');
        await appliquer(LUNDI_1(), planifiee);
        expect((await request(app).delete(`/api/admin/semaines-types/${planifiee}`)).body.error).toContain('1 semaine(s) à venir');

        const vacances = await creerType('Vacances');
        const creneau = await creerCreneau([vacances]);
        await db.run(`INSERT INTO semaines (lundi, semaine_type_id) VALUES ('2020-01-06', ?)`, [vacances]);
        expect((await request(app).delete(`/api/admin/semaines-types/${vacances}`)).status).toBe(200);
        expect(await db.get(`SELECT id FROM creneaux WHERE id = ?`, [creneau])).toEqual({ id: creneau });
        expect(await db.query(`SELECT * FROM semaine_type_creneaux WHERE semaine_type_id = ?`, [vacances])).toEqual([]);
        expect(await db.query(`SELECT * FROM semaines WHERE semaine_type_id = ?`, [vacances])).toEqual([]);
    });

    it('réserve la gestion aux administrateurs', async () => {
        connecter(anne);
        expect((await request(app).get('/api/admin/semaines-types')).status).toBe(403);
        expect((await request(app).get('/api/admin/semaines')).status).toBe(403);
        expect((await appliquer(LUNDI_1(), standard)).status).toBe(403);
        expect((await choisirCreneaux(standard, [])).status).toBe(403);
    });
});

describe('planning des semaines', () => {

    it('présente quatre semaines, par défaut en semaine type standard', async () => {
        await creerCreneau([standard]);
        const vacances = await creerType('Vacances');
        await appliquer(LUNDI_2(), vacances);

        const res = await request(app).get('/api/admin/semaines');

        expect(res.body.map(s => [s.offset, s.lundi, s.semaine_type_nom, s.explicite])).toEqual([
            [0, seances.lundiDeLaSemaine(0), 'Semaine standard', false],
            [1, LUNDI_1(), 'Semaine standard', false],
            [2, LUNDI_2(), 'Vacances', true],
            [3, seances.lundiDeLaSemaine(3), 'Semaine standard', false]
        ]);
        expect(res.body[1]).toMatchObject({ nb_seances: 1, nb_inscriptions: 0, dimanche: seances.ajouterJours(LUNDI_1(), 6) });
        expect(res.body[2].nb_seances).toBe(0);
    });

    it('génère chaque semaine d\'après sa semaine type', async () => {
        const vacances = await creerType('Vacances');
        await creerCreneau([standard], { nom: 'Standard lundi' });
        await creerCreneau([vacances], { nom: 'Vacances mardi', jour_semaine: 2 });
        await creerCreneau([standard, vacances], { nom: 'Commun mercredi', jour_semaine: 3 });
        await db.run(`INSERT INTO semaines (lundi, semaine_type_id) VALUES (?, ?)`, [LUNDI_2(), vacances]);
        connecter(anne);

        const semaine1 = await request(app).get('/api/seances?semaine=1');
        connecter(admin);
        const semaine2 = await request(app).get('/api/seances?semaine=2');

        expect(semaine1.body.map(s => s.nom)).toEqual(['Standard lundi', 'Commun mercredi']);
        expect(semaine2.body.map(s => s.nom)).toEqual(['Vacances mardi', 'Commun mercredi']);
    });

    it('refuse les semaines mal désignées ou hors du planning', async () => {
        expect((await appliquer(seances.ajouterJours(LUNDI_1(), 1), standard)).body.error).toContain('lundi');
        expect((await appliquer(seances.lundiDeLaSemaine(-1), standard)).body.error).toContain('passée');
        expect((await appliquer(seances.lundiDeLaSemaine(4), standard)).body.error).toContain('4 prochaines semaines');
        expect((await appliquer('n-importe-quoi', standard)).status).toBe(400);
        expect((await appliquer(LUNDI_1(), 999999)).status).toBe(404);
        expect((await request(app).post(`/api/admin/semaines/${LUNDI_1()}`).send({})).status).toBe(400);
    });
});

describe('appliquer une semaine type à une semaine', () => {
    let vacances, seanceCommune, seanceMardi;

    // Standard : lundi 7h (partagé avec Vacances) et mardi 7h, tous deux avec
    // des inscrits. Vacances : lundi 7h et mercredi 18h.
    beforeEach(async () => {
        vacances = await creerType('Vacances');
        await creerCreneau([standard, vacances], { nom: 'Lundi commun', capacite_max: 1 });
        await creerCreneau([standard], { nom: 'Mardi standard', jour_semaine: 2 });
        await creerCreneau([vacances], { nom: 'Mercredi vacances', jour_semaine: 3, heure_debut: '18:00', heure_fin: '19:00' });

        await seances.genererSemaine(db, LUNDI_1());
        [seanceCommune, seanceMardi] = await seancesDeLaSemaine(LUNDI_1());
        await inscrire(anne, seanceCommune.id);
        await inscrire(bruno, seanceCommune.id); // en attente : une seule place
        await inscrire(anne, seanceMardi.id);
    });

    it("décrit l'impact sans rien modifier en simulation", async () => {
        const res = await appliquer(LUNDI_1(), vacances, true);

        expect(res.body.simulation).toBe(true);
        expect(res.body.bilan).toMatchObject({ conservees: 1, creees: 1, reactivees: 0, personnes_concernees: 1 });
        expect(res.body.bilan.annulees).toEqual([expect.objectContaining({
            id: seanceMardi.id, nom: 'Mardi standard', inscrits: [{ nom: 'Nom', prenom: 'anne', statut: 'inscrit' }]
        })]);
        expect(res.body.bilan.annulees[0].inscrits[0].email).toBeUndefined();

        expect(resume(await seancesDeLaSemaine(LUNDI_1()))).toEqual(['Lundi commun', 'Mardi standard']);
        expect(await db.query(`SELECT * FROM semaines`)).toEqual([]);
    });

    it('garde la séance du créneau partagé avec ses inscrits, annule les autres et crée les manquantes', async () => {
        const res = await appliquer(LUNDI_1(), vacances);

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('1 séance(s) annulée(s), 1 personne(s) prévenue(s)');

        const semaine = await seancesDeLaSemaine(LUNDI_1());
        expect(resume(semaine)).toEqual(['Lundi commun', 'Mardi standard (annulée)', 'Mercredi vacances']);
        expect(semaine[0]).toMatchObject({ id: seanceCommune.id, inscrits: 1, en_attente: 1 });
        expect(semaine[1]).toMatchObject({ inscrits: 0, motif_annulation: 'semaine_type' });

        connecter(anne);
        expect((await request(app).get('/api/seances?semaine=1')).body.map(s => s.nom)).toEqual(['Lundi commun', 'Mercredi vacances']);
        expect((await request(app).get('/api/mes-inscriptions')).body.map(i => i.nom)).toEqual(['Lundi commun']);
    });

    it('rétablit les séances annulées en revenant à la semaine type initiale', async () => {
        await appliquer(LUNDI_1(), vacances);

        const retour = await appliquer(LUNDI_1(), standard);

        expect(retour.body.bilan).toMatchObject({ conservees: 1, reactivees: 1, creees: 0 });
        expect(retour.body.bilan.annulees.map(s => s.nom)).toEqual(['Mercredi vacances']);
        const semaine = await seancesDeLaSemaine(LUNDI_1());
        expect(resume(semaine)).toEqual(['Lundi commun', 'Mardi standard', 'Mercredi vacances (annulée)']);
        expect(semaine.map(s => s.inscrits)).toEqual([1, 0, 0]);
    });

    it('supporte les allers-retours sans doublon de séance', async () => {
        for (const type of [vacances, standard, vacances, standard, vacances]) {
            expect((await appliquer(LUNDI_1(), type)).status).toBe(200);
        }

        const actives = (await seancesDeLaSemaine(LUNDI_1(), { inclureAnnulees: false })).map(s => s.nom);
        expect(actives).toEqual(['Lundi commun', 'Mercredi vacances']);
        expect((await db.get(`SELECT COUNT(*) AS n FROM seances`)).n).toBe(3);
        expect((await seancesDeLaSemaine(LUNDI_1()))[0]).toMatchObject({ id: seanceCommune.id, inscrits: 1, en_attente: 1 });
    });

    it('fait suivre la nouvelle semaine type par défaut aux semaines sans choix explicite', async () => {
        await appliquer(LUNDI_2(), standard); // choix explicite : ne bougera pas
        await seances.genererSemaine(db, LUNDI_2());

        const res = await request(app).put(`/api/admin/semaines-types/${vacances}/defaut`);

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('séance(s) annulée(s)');
        expect(resume(await seancesDeLaSemaine(LUNDI_1(), { inclureAnnulees: false }))).toEqual(['Lundi commun', 'Mercredi vacances']);
        expect(resume(await seancesDeLaSemaine(LUNDI_2(), { inclureAnnulees: false }))).toEqual(['Lundi commun', 'Mardi standard']);

        const planning = (await request(app).get('/api/admin/semaines')).body;
        expect(planning.map(s => [s.semaine_type_nom, s.explicite])).toEqual([
            ['Vacances', false], ['Vacances', false], ['Semaine standard', true], ['Vacances', false]
        ]);
    });
});

describe('choisir les créneaux d\'une semaine type', () => {
    let lundi, mardi, jeudi, seanceMardi;

    beforeEach(async () => {
        lundi = await creerCreneau([standard], { nom: 'Lundi' });
        mardi = await creerCreneau([standard], { nom: 'Mardi', jour_semaine: 2 });
        jeudi = await creerCreneau([], { nom: 'Jeudi', jour_semaine: 4 });
        await seances.genererSemaine(db, LUNDI_1());
        seanceMardi = (await seancesDeLaSemaine(LUNDI_1())).find(s => s.nom === 'Mardi');
        await inscrire(anne, seanceMardi.id);
    });

    it("montre l'impact sur chaque semaine qui suit la semaine type, sans rien modifier", async () => {
        const vacances = await creerType('Vacances');
        await appliquer(seances.lundiDeLaSemaine(3), vacances); // cette semaine-là n'est pas concernée

        const res = await choisirCreneaux(standard, [lundi, jeudi], true);

        expect(res.body.semaines.map(s => s.lundi)).toEqual([0, 1, 2].map(o => seances.lundiDeLaSemaine(o)));
        expect(res.body.semaines[1]).toMatchObject({ conservees: 1, creees: 1, personnes_concernees: 1 });
        expect(await semainesTypes.creneauxDuType(db, standard)).toEqual(expect.arrayContaining([lundi, mardi]));
    });

    it('retire et ajoute des séances dans les semaines concernées', async () => {
        const res = await choisirCreneaux(standard, [lundi, jeudi]);

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('1 personne(s) prévenue(s)');
        expect(resume(await seancesDeLaSemaine(LUNDI_1()))).toEqual(['Lundi', 'Mardi (annulée)', 'Jeudi']);
        expect(await db.query(`SELECT * FROM inscriptions WHERE seance_id = ?`, [seanceMardi.id])).toEqual([]);

        // Les semaines suivantes suivent aussi la nouvelle sélection
        await seances.genererSemaine(db, LUNDI_2());
        expect(resume(await seancesDeLaSemaine(LUNDI_2()))).toEqual(['Lundi', 'Jeudi']);

        // La planification reste implicite (semaine type par défaut)
        expect(await db.query(`SELECT * FROM semaines`)).toEqual([]);
    });

    it('refuse une sélection mal formée', async () => {
        expect((await choisirCreneaux(standard, [lundi, 999999])).body.error).toBe('Créneau inconnu');
        expect((await request(app).put(`/api/admin/semaines-types/${standard}/creneaux`).send({})).status).toBe(400);
        expect((await choisirCreneaux(999999, [])).status).toBe(404);
    });
});