// Semaines types : parcours complets sur le vrai serveur et une base SQLite
// en mémoire. Seuls la session et l'envoi d'emails sont simulés.
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
let admin, anne, bruno;

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

const creerCreneau = async (typeId, champs = {}) => {
    const c = { nom: 'Créneau', sport_id: natation, jour_semaine: 1, heure_debut: '07:00', heure_fin: '08:00',
        capacite_max: 5, ...champs };
    const res = await db.run(
        `INSERT INTO creneaux (nom, sport_id, jour_semaine, heure_debut, heure_fin, capacite_max, public_cible, semaine_type_id)
         VALUES (?, ?, ?, ?, ?, ?, 'les deux', ?)`,
        [c.nom, c.sport_id, c.jour_semaine, c.heure_debut, c.heure_fin, c.capacite_max, typeId]
    );
    return res.lastID;
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

const TABLES = ['inscriptions', 'waitlist_tokens', 'seances', 'bloc_creneaux', 'blocs', 'creneaux', 'semaines'];

beforeAll(async () => {
    await app.locals.dbPrete;
    natation = (await db.get(`SELECT id FROM sports WHERE slug = 'natation'`)).id;
    velo = (await db.get(`SELECT id FROM sports WHERE slug = 'velo'`)).id;
    admin = { ...(await db.get(`SELECT id, role FROM users WHERE role = 'admin' LIMIT 1`)) };
    anne = await creerMembre('anne@x.fr');
    bruno = await creerMembre('bruno@x.fr');
});

beforeEach(async () => {
    for (const table of TABLES) await db.run(`DELETE FROM ${table}`);
    await db.run(`DELETE FROM semaines_types WHERE par_defaut = 0`);
    standard = (await semainesTypes.typeParDefaut(db)).id;
    connecter(admin);
});

describe('migration et création de créneaux', () => {

    it('crée une seule semaine type par défaut et y rattache les créneaux existants', async () => {
        const orphelin = (await db.run(
            `INSERT INTO creneaux (nom, sport_id, jour_semaine, heure_debut, heure_fin, capacite_max) VALUES ('Ancien', ?, 2, '07:00', '08:00', 4)`,
            [natation]
        )).lastID;

        await semainesTypes.migrer(db);
        await semainesTypes.migrer(db);

        const types = await request(app).get('/api/admin/semaines-types');
        expect(types.body).toEqual([{ id: standard, nom: 'Semaine standard', par_defaut: true, nb_creneaux: 1 }]);
        expect((await db.get(`SELECT semaine_type_id FROM creneaux WHERE id = ?`, [orphelin])).semaine_type_id).toBe(standard);
    });

    it('range un nouveau créneau dans la semaine type demandée, sinon celle par défaut', async () => {
        const vacances = await creerType('Vacances');
        const base = { nom: 'Nouveau', sport_id: velo, jour_semaine: 3, heure_debut: '18:00', heure_fin: '19:00', capacite_max: 8 };

        const sansType = await request(app).post('/api/creneaux').send(base);
        const avecType = await request(app).post('/api/creneaux').send({ ...base, semaine_type_id: vacances });
        const inconnu = await request(app).post('/api/creneaux').send({ ...base, semaine_type_id: 999999 });

        expect(inconnu.status).toBe(400);
        const types = await db.query(`SELECT id, semaine_type_id FROM creneaux ORDER BY id`);
        expect(types).toEqual([
            { id: sansType.body.creneauId, semaine_type_id: standard },
            { id: avecType.body.creneauId, semaine_type_id: vacances }
        ]);

        const liste = await request(app).get(`/api/creneaux?semaine_type=${vacances}`);
        expect(liste.body.map(c => [c.id, c.semaine_type_nom])).toEqual([[avecType.body.creneauId, 'Vacances']]);
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

        const liste = await request(app).get('/api/admin/semaines-types');
        expect(liste.body.map(t => t.nom)).toEqual(['Semaine standard', 'Vacances']);
    });

    it('duplique une semaine type avec ses créneaux et leurs blocs', async () => {
        const lundi = await creerCreneau(standard, { nom: 'Lundi' });
        await creerCreneau(standard, { nom: 'Mardi', jour_semaine: 2 });
        const bloc = (await db.run(`INSERT INTO blocs (nom, sport_id) VALUES ('Début', ?)`, [natation])).lastID;
        await db.run(`INSERT INTO bloc_creneaux (bloc_id, creneau_id) VALUES (?, ?)`, [bloc, lundi]);

        const res = await request(app).post('/api/admin/semaines-types').send({ nom: 'Vacances', source_id: standard });

        expect(res.body.message).toContain('2 créneau(x)');
        const copies = await db.query(`SELECT id, nom FROM creneaux WHERE semaine_type_id = ? ORDER BY nom`, [res.body.semaine_type.id]);
        expect(copies.map(c => c.nom)).toEqual(['Lundi', 'Mardi']);
        const blocsCopie = await db.query(`SELECT bloc_id FROM bloc_creneaux WHERE creneau_id = ?`, [copies[0].id]);
        expect(blocsCopie).toEqual([{ bloc_id: bloc }]);
    });

    it('protège les semaines types encore utilisées', async () => {
        expect((await request(app).delete(`/api/admin/semaines-types/${standard}`)).body.error).toContain('par défaut');

        const pleine = await creerType('Pleine');
        await creerCreneau(pleine);
        expect((await request(app).delete(`/api/admin/semaines-types/${pleine}`)).body.error).toContain('1 créneau(x)');

        const planifiee = await creerType('Planifiée');
        await appliquer(LUNDI_1(), planifiee);
        expect((await request(app).delete(`/api/admin/semaines-types/${planifiee}`)).body.error).toContain('1 semaine(s) à venir');

        const libre = await creerType('Libre');
        await db.run(`INSERT INTO semaines (lundi, semaine_type_id) VALUES ('2020-01-06', ?)`, [libre]);
        expect((await request(app).delete(`/api/admin/semaines-types/${libre}`)).status).toBe(200);
        expect(await db.query(`SELECT * FROM semaines WHERE semaine_type_id = ?`, [libre])).toEqual([]);
    });

    it('réserve la gestion aux administrateurs', async () => {
        connecter(anne);
        expect((await request(app).get('/api/admin/semaines-types')).status).toBe(403);
        expect((await request(app).get('/api/admin/semaines')).status).toBe(403);
        expect((await appliquer(LUNDI_1(), standard)).status).toBe(403);
    });
});

describe('planning des semaines', () => {

    it('présente quatre semaines, par défaut en semaine type standard', async () => {
        await creerCreneau(standard);
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
        await creerCreneau(standard, { nom: 'Standard lundi' });
        const vacances = await creerType('Vacances');
        await creerCreneau(vacances, { nom: 'Vacances mardi', jour_semaine: 2 });
        await db.run(`INSERT INTO semaines (lundi, semaine_type_id) VALUES (?, ?)`, [LUNDI_2(), vacances]);
        connecter(anne);

        const semaine1 = await request(app).get('/api/seances?semaine=1');
        connecter(admin);
        const semaine2 = await request(app).get('/api/seances?semaine=2');

        expect(semaine1.body.map(s => s.nom)).toEqual(['Standard lundi']);
        expect(semaine2.body.map(s => s.nom)).toEqual(['Vacances mardi']);
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
    let vacances, seanceLundi, seanceMardi;

    // Standard : lundi 7h et mardi 7h, tous deux avec des inscrits.
    // Vacances : lundi 7h (même horaire, 10 places) et mercredi 18h.
    beforeEach(async () => {
        await creerCreneau(standard, { nom: 'Lundi standard', capacite_max: 1 });
        await creerCreneau(standard, { nom: 'Mardi standard', jour_semaine: 2 });
        vacances = await creerType('Vacances');
        await creerCreneau(vacances, { nom: 'Lundi vacances', capacite_max: 10 });
        await creerCreneau(vacances, { nom: 'Mercredi vacances', jour_semaine: 3, heure_debut: '18:00', heure_fin: '19:00' });

        await seances.genererSemaine(db, LUNDI_1());
        [seanceLundi, seanceMardi] = await seancesDeLaSemaine(LUNDI_1());
        await inscrire(anne, seanceLundi.id);
        await inscrire(bruno, seanceLundi.id); // en attente : une seule place
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

        expect(resume(await seancesDeLaSemaine(LUNDI_1()))).toEqual(['Lundi standard', 'Mardi standard']);
        expect(await db.query(`SELECT * FROM semaines`)).toEqual([]);
    });

    it('conserve la séance équivalente avec ses inscrits, annule les autres et crée les manquantes', async () => {
        const res = await appliquer(LUNDI_1(), vacances);

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('1 séance(s) annulée(s), 1 personne(s) prévenue(s)');
        // La séance du lundi passe à 10 places : Bruno quitte la liste d'attente
        expect(res.body.message).toContain("1 personne(s) en liste d'attente ont obtenu une place");

        const semaine = await seancesDeLaSemaine(LUNDI_1());
        expect(resume(semaine)).toEqual(['Lundi vacances', 'Mardi standard (annulée)', 'Mercredi vacances']);
        expect(semaine[0]).toMatchObject({ id: seanceLundi.id, capacite_max: 10, inscrits: 2, en_attente: 0 });
        expect(semaine[1]).toMatchObject({ inscrits: 0, motif_annulation: 'semaine_type' });

        const lienCreneau = await db.get(`SELECT DISTINCT creneau_id FROM inscriptions WHERE seance_id = ?`, [seanceLundi.id]);
        expect(lienCreneau.creneau_id).toBe(semaine[0].creneau_id);

        // Les membres ne voient pas la séance annulée
        connecter(anne);
        expect((await request(app).get('/api/seances?semaine=1')).body.map(s => s.nom)).toEqual(['Lundi vacances', 'Mercredi vacances']);
        expect((await request(app).get('/api/mes-inscriptions')).body.map(i => i.nom)).toEqual(['Lundi vacances']);
    });

    it('rétablit les séances annulées et rattache les conservées en revenant à la semaine type initiale', async () => {
        await appliquer(LUNDI_1(), vacances);

        const retour = await appliquer(LUNDI_1(), standard);

        expect(retour.body.bilan).toMatchObject({ conservees: 1, reactivees: 1, creees: 0 });
        expect(retour.body.bilan.annulees.map(s => s.nom)).toEqual(['Mercredi vacances']);
        const semaine = await seancesDeLaSemaine(LUNDI_1());
        expect(resume(semaine)).toEqual(['Lundi standard', 'Mardi standard', 'Mercredi vacances (annulée)']);
        // Les inscrits du lundi ont suivi, ceux du mardi avaient été désinscrits
        expect(semaine.map(s => s.inscrits)).toEqual([2, 0, 0]);
        expect((await db.query(`SELECT * FROM semaines`))).toEqual([
            expect.objectContaining({ lundi: LUNDI_1(), semaine_type_id: standard })
        ]);
    });

    it('supporte les allers-retours sans doublon de séance', async () => {
        for (const type of [vacances, standard, vacances, standard, vacances]) {
            expect((await appliquer(LUNDI_1(), type)).status).toBe(200);
        }

        const actives = (await seancesDeLaSemaine(LUNDI_1(), { inclureAnnulees: false })).map(s => s.nom);
        expect(actives).toEqual(['Lundi vacances', 'Mercredi vacances']);
        const doublons = await db.get(
            `SELECT COUNT(*) AS n FROM (SELECT creneau_id FROM seances GROUP BY creneau_id, date_seance HAVING COUNT(*) > 1)`
        );
        expect(doublons.n).toBe(0);
        expect((await seancesDeLaSemaine(LUNDI_1()))[0]).toMatchObject({ id: seanceLundi.id, inscrits: 2 });
    });

    it('fait suivre la nouvelle semaine type par défaut aux semaines sans choix explicite', async () => {
        await appliquer(LUNDI_2(), standard); // choix explicite : ne bougera pas
        await seances.genererSemaine(db, LUNDI_2());

        const res = await request(app).put(`/api/admin/semaines-types/${vacances}/defaut`);

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('séance(s) annulée(s)');
        const types = await request(app).get('/api/admin/semaines-types');
        expect(types.body.filter(t => t.par_defaut).map(t => t.nom)).toEqual(['Vacances']);

        expect(resume(await seancesDeLaSemaine(LUNDI_1(), { inclureAnnulees: false }))).toEqual(['Lundi vacances', 'Mercredi vacances']);
        expect(resume(await seancesDeLaSemaine(LUNDI_2(), { inclureAnnulees: false }))).toEqual(['Lundi standard', 'Mardi standard']);

        const planning = (await request(app).get('/api/admin/semaines')).body;
        expect(planning.map(s => [s.semaine_type_nom, s.explicite])).toEqual([
            ['Vacances', false], ['Vacances', false], ['Semaine standard', true], ['Vacances', false]
        ]);
    });
});