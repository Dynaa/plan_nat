// Ajustements séance par séance (phase D) : parcours complets sur le vrai
// serveur et une base SQLite en mémoire. Seuls la session et l'envoi
// d'emails sont simulés.
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
const jourSemaine1 = (jour) => seances.dateDuJour(LUNDI_1(), jour);

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

const creerCreneau = async (champs = {}) => {
    const c = { nom: 'Lundi 7h', sport_id: natation, jour_semaine: 1, heure_debut: '07:00', heure_fin: '08:00',
        capacite_max: 1, semaine_type_id: standard, ...champs };
    return (await db.run(
        `INSERT INTO creneaux (nom, sport_id, jour_semaine, heure_debut, heure_fin, capacite_max, public_cible, semaine_type_id)
         VALUES (?, ?, ?, ?, ?, ?, 'les deux', ?)`,
        [c.nom, c.sport_id, c.jour_semaine, c.heure_debut, c.heure_fin, c.capacite_max, c.semaine_type_id]
    )).lastID;
};

const seanceDuCreneau = async (creneauId) => {
    await seances.genererSemaine(db, LUNDI_1());
    const creneau = await db.get(`SELECT jour_semaine FROM creneaux WHERE id = ?`, [creneauId]);
    return seances.trouverSeanceParCreneau(db, creneauId, seances.dateDuJour(LUNDI_1(), creneau.jour_semaine));
};

const inscrire = async (membre, seanceId) => {
    connecter(membre);
    const res = await request(app).post('/api/inscriptions').send({ seanceId });
    connecter(admin);
    return res;
};

const inscriptionsDe = (seanceId) => db.query(
    `SELECT user_id, statut, position_attente, date_seance, creneau_id FROM inscriptions WHERE seance_id = ? ORDER BY statut DESC, user_id`,
    [seanceId]
);

const ponctuelle = (champs = {}) => request(app).post('/api/admin/seances').send({
    nom: 'Stage', sport_id: velo, date_seance: jourSemaine1(3), heure_debut: '14:00', heure_fin: '17:00',
    capacite_max: 1, lieu: 'Col de la Croix', ...champs
});

const modifier = (seance, champs = {}) => request(app).put(`/api/admin/seances/${seance.id}`).send({
    nom: seance.nom, date_seance: seance.date_seance, heure_debut: seance.heure_debut, heure_fin: seance.heure_fin,
    capacite_max: seance.capacite_max, sans_limite: seance.sans_limite, lieu: seance.lieu, public_cible: seance.public_cible,
    ...champs
});

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

describe('schéma', () => {
    it('accepte des inscriptions et des jetons sans créneau', async () => {
        for (const table of ['inscriptions', 'waitlist_tokens']) {
            const colonne = (await db.query(`PRAGMA table_info(${table})`)).find(c => c.name === 'creneau_id');
            expect(colonne.notnull).toBe(0);
        }
        // Les index survivent à la reconstruction
        const index = (await db.query(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'inscriptions'`)).map(i => i.name);
        expect(index).toEqual(expect.arrayContaining(['idx_inscriptions_seance', 'idx_inscriptions_user_seance']));
    });
});

describe('séances d\'une semaine (admin)', () => {
    it('liste toutes les séances, annulées comprises, et reste réservée aux admins', async () => {
        const seance = await seanceDuCreneau(await creerCreneau());
        await request(app).post(`/api/admin/seances/${seance.id}/annulation`);

        const res = await request(app).get('/api/admin/seances?semaine=1');
        expect(res.body).toMatchObject({ lundi: LUNDI_1(), dimanche: seances.ajouterJours(LUNDI_1(), 6) });
        expect(res.body.seances.map(s => [s.nom, s.annulee, s.motif_annulation])).toEqual([['Lundi 7h', true, 'admin']]);

        expect((await request(app).get('/api/admin/seances?semaine=4')).status).toBe(400);
        connecter(anne);
        expect((await request(app).get('/api/admin/seances?semaine=1')).status).toBe(403);
        expect((await request(app).post(`/api/admin/seances/${seance.id}/annulation`)).status).toBe(403);
    });
});

describe('séance ponctuelle', () => {
    it('se crée hors semaine type, se réserve et gère sa liste d\'attente', async () => {
        const creation = await ponctuelle();
        expect(creation.status).toBe(200);
        expect(creation.body.seance).toMatchObject({ creneau_id: null, sport_id: velo, date_seance: jourSemaine1(3), lieu: 'Col de la Croix' });
        const id = creation.body.seance.id;

        connecter(anne);
        expect((await request(app).get('/api/seances?semaine=1')).body.map(s => s.nom)).toEqual(['Stage']);
        await request(app).post('/api/inscriptions').send({ seanceId: id });
        connecter(bruno);
        expect((await request(app).post('/api/inscriptions').send({ seanceId: id })).body.statut).toBe('attente');

        // Anne se retire : Bruno reçoit un lien, sans créneau associé
        connecter(anne);
        const depart = await request(app).delete(`/api/seances/${id}/inscription`);
        expect(depart.body.emailsEnvoyes).toBe(1);
        const jeton = await db.get(`SELECT token, creneau_id, seance_id FROM waitlist_tokens`);
        expect(jeton).toMatchObject({ creneau_id: null, seance_id: id });

        const confirmation = await request(app).post('/api/inscription-attente').send({ token: jeton.token });
        expect(confirmation.body.success).toBe(true);
        connecter(bruno);
        expect((await request(app).get('/api/mes-inscriptions')).body.map(i => [i.nom, i.statut, i.creneau_id]))
            .toEqual([['Stage', 'inscrit', null]]);
    });

    it('prend la capacité par défaut du sport si aucune n\'est saisie', async () => {
        await db.run(`UPDATE sports SET capacite_defaut = 30 WHERE id = ?`, [velo]);
        const res = await ponctuelle({ capacite_max: '' });
        await db.run(`UPDATE sports SET capacite_defaut = NULL WHERE id = ?`, [velo]);
        expect(res.body.seance.capacite_max).toBe(30);
    });

    it.each([
        [{ date_seance: seances.ajouterJours(seances.aujourdhuiIso(), -1) }, 'passé'],
        [{ date_seance: seances.ajouterJours(seances.lundiDeLaSemaine(4), 0) }, '4 prochaines semaines'],
        [{ date_seance: 'demain' }, 'Date invalide'],
        [{ sport_id: null }, 'Sport requis'],
        [{ nom: '  ' }, 'nom'],
        [{ heure_debut: '18:00', heure_fin: '17:00' }, "l'heure de début"],
        [{ heure_debut: '25:00' }, 'Horaires invalides'],
        [{ capacite_max: 0 }, 'capacité']
    ])('refuse une saisie invalide (%j)', async (champs, erreur) => {
        const res = await ponctuelle(champs);
        expect(res.status).toBe(400);
        expect(res.body.error).toContain(erreur);
    });

    it('accepte une séance sans limite de places', async () => {
        const res = await ponctuelle({ capacite_max: 0, sans_limite: true });
        expect(res.body.seance).toMatchObject({ sans_limite: true });
    });
});

describe('modifier une séance', () => {
    let creneau, seance;
    beforeEach(async () => {
        creneau = await creerCreneau({ lieu: null });
        seance = await seanceDuCreneau(creneau);
        await inscrire(anne, seance.id);
        await inscrire(bruno, seance.id); // en attente
    });

    it('prévient les inscrits d\'un changement de jour, d\'horaire ou de lieu', async () => {
        const res = await modifier(seance, { date_seance: jourSemaine1(2), heure_debut: '08:00', heure_fin: '09:00', lieu: 'Piscine B' });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('2 personne(s) prévenue(s)');
        expect(res.body.changements.map(c => c.libelle)).toEqual(['Date', 'Horaire', 'Lieu']);
        expect(res.body.seance).toMatchObject({ date_seance: jourSemaine1(2), heure_debut: '08:00', lieu: 'Piscine B', modifiee: true });
        expect((await inscriptionsDe(seance.id)).map(i => i.date_seance)).toEqual([jourSemaine1(2), jourSemaine1(2)]);
    });

    it('ne prévient personne pour un simple changement de nom', async () => {
        const res = await modifier(seance, { nom: 'Lundi renommé' });
        expect(res.body).toMatchObject({ message: 'Séance modifiée', changements: [] });
    });

    it('promeut la liste d\'attente quand la capacité augmente', async () => {
        const res = await modifier(seance, { capacite_max: 2 });

        expect(res.body.message).toContain("1 personne(s) en liste d'attente ont obtenu une place");
        expect((await inscriptionsDe(seance.id)).map(i => i.statut)).toEqual(['inscrit', 'inscrit']);
    });

    it('ne suit plus les modifications de son créneau', async () => {
        await modifier(seance, { nom: 'Ajustée' });
        await request(app).put(`/api/creneaux/${creneau}`).send({
            nom: 'Créneau modifié', sport_id: natation, jour_semaine: 1, heure_debut: '07:00', heure_fin: '08:00', capacite_max: 1
        });
        expect((await seances.trouverSeance(db, seance.id)).nom).toBe('Ajustée');
    });

    it('garde une séance de créneau dans sa semaine, mais laisse voyager une séance ponctuelle', async () => {
        const deplacement = await modifier(seance, { date_seance: seances.dateDuJour(seances.lundiDeLaSemaine(2), 1) });
        expect(deplacement.status).toBe(400);
        expect(deplacement.body.error).toContain('dans sa semaine');

        const stage = (await ponctuelle()).body.seance;
        const voyage = await modifier(stage, { date_seance: seances.dateDuJour(seances.lundiDeLaSemaine(3), 5) });
        expect(voyage.status).toBe(200);
    });

    it('refuse de modifier une séance annulée, passée ou inconnue', async () => {
        await request(app).post(`/api/admin/seances/${seance.id}/annulation`);
        expect((await modifier(seance)).body.error).toContain('rétablissez-la');

        await db.run(`UPDATE seances SET date_seance = '2020-01-06', annulee = 0 WHERE id = ?`, [seance.id]);
        expect((await modifier(seance)).body.error).toContain('passée');

        expect((await modifier({ ...seance, id: 999999 })).status).toBe(404);
    });
});

describe('annuler et rétablir une séance', () => {
    let seance;
    beforeEach(async () => {
        seance = await seanceDuCreneau(await creerCreneau());
        await inscrire(anne, seance.id);
        await inscrire(bruno, seance.id);
    });

    it('désinscrit et prévient, puis laisse la séance visible et barrée pour les membres', async () => {
        const res = await request(app).post(`/api/admin/seances/${seance.id}/annulation`);

        expect(res.body.message).toContain('2 personne(s) désinscrite(s) et prévenue(s)');
        expect(await inscriptionsDe(seance.id)).toEqual([]);
        expect((await request(app).post(`/api/admin/seances/${seance.id}/annulation`)).body.error).toContain('déjà annulée');

        connecter(anne);
        const vue = await request(app).get('/api/seances?semaine=1');
        expect(vue.body.map(s => [s.nom, s.annulee])).toEqual([['Lundi 7h', true]]);
        expect((await request(app).post('/api/inscriptions').send({ seanceId: seance.id })).body.error).toBe('Cette séance est annulée');
    });

    it('rouvre les inscriptions une fois rétablie', async () => {
        await request(app).post(`/api/admin/seances/${seance.id}/annulation`);

        const res = await request(app).delete(`/api/admin/seances/${seance.id}/annulation`);

        expect(res.status).toBe(200);
        expect(res.body.seance).toMatchObject({ annulee: false, motif_annulation: null });
        expect((await inscrire(anne, seance.id)).status).toBe(200);
        expect((await request(app).delete(`/api/admin/seances/${seance.id}/annulation`)).body.error).toContain("n'est pas annulée");
    });

    it('laisse une séance retirée par une semaine type à la gestion des semaines types', async () => {
        const vacances = (await db.run(`INSERT INTO semaines_types (nom, par_defaut) VALUES ('Vacances', 0)`)).lastID;
        await request(app).post(`/api/admin/semaines/${LUNDI_1()}`).send({ semaine_type_id: vacances });

        const res = await request(app).delete(`/api/admin/seances/${seance.id}/annulation`);

        expect(res.status).toBe(400);
        expect(res.body.error).toContain('réappliquez la semaine type');
        // Les membres ne voient pas ces séances-là
        connecter(anne);
        expect((await request(app).get('/api/seances?semaine=1')).body).toEqual([]);
    });

    it("conserve l'annulation décidée par le club lors des changements de semaine type", async () => {
        await request(app).post(`/api/admin/seances/${seance.id}/annulation`);
        const vacances = (await db.run(`INSERT INTO semaines_types (nom, par_defaut) VALUES ('Vacances', 0)`)).lastID;
        await creerCreneau({ nom: 'Lundi vacances', semaine_type_id: vacances });

        // Aller : la séance vacances est créée ; retour : l'annulation du club tient
        await request(app).post(`/api/admin/semaines/${LUNDI_1()}`).send({ semaine_type_id: vacances });
        const retour = await request(app).post(`/api/admin/semaines/${LUNDI_1()}`).send({ semaine_type_id: standard });

        expect(retour.body.bilan).toMatchObject({ conservees: 0, reactivees: 0 });
        const semaine = (await request(app).get('/api/admin/seances?semaine=1')).body.seances;
        expect(semaine.map(s => [s.nom, s.annulee, s.motif_annulation])).toEqual([
            ['Lundi 7h', true, 'admin'],
            ['Lundi vacances', true, 'semaine_type']
        ]);
    });
});