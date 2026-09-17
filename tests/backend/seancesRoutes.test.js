// Parcours complets autour des séances datées, sur le vrai serveur et une
// base SQLite en mémoire : seuls la session et l'envoi d'emails sont simulés.
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

// Session pilotée par chaque test
const mockSession = {};
jest.mock('express-session', () => () => (req, res, next) => {
    req.session = mockSession;
    next();
});

const app = require('../../server');
const seances = require('../../services/seances');

const db = app.locals.db;
let natation, velo;
let admin, anne, bruno, chloe;

const connecter = (user) => {
    mockSession.userId = user.id;
    mockSession.userRole = user.role;
};

const creerMembre = async (email, licence = 'Loisir/Senior', publicCible = 'adulte') => {
    const res = await db.run(
        `INSERT INTO users (email, password, nom, prenom, licence_type, public_cible) VALUES (?, 'x', 'Nom', ?, ?, ?)`,
        [email, email.split('@')[0], licence, publicCible]
    );
    return { id: res.lastID, email, role: 'membre' };
};

const creerCreneau = async (champs = {}) => {
    const c = { nom: 'Créneau', sport_id: natation, jour_semaine: 0, heure_debut: '10:00', heure_fin: '11:00',
        capacite_max: 1, sans_limite: 0, public_cible: 'les deux', ...champs };
    const res = await db.run(
        `INSERT INTO creneaux (nom, sport_id, jour_semaine, heure_debut, heure_fin, capacite_max, sans_limite, public_cible)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.nom, c.sport_id, c.jour_semaine, c.heure_debut, c.heure_fin, c.capacite_max, c.sans_limite, c.public_cible]
    );
    // Le créneau fait partie de la semaine type par défaut
    await db.run(
        `INSERT INTO semaine_type_creneaux (semaine_type_id, creneau_id) SELECT id, ? FROM semaines_types WHERE par_defaut = true`,
        [res.lastID]
    );
    return res.lastID;
};

// Séance d'un créneau pour une semaine (0 = en cours), générée au besoin
const seanceDe = async (creneauId, semaine = 0) => {
    const lundi = seances.lundiDeLaSemaine(semaine);
    await seances.genererSemaine(db, lundi);
    const creneau = await db.get(`SELECT jour_semaine FROM creneaux WHERE id = ?`, [creneauId]);
    return seances.trouverSeanceParCreneau(db, creneauId, seances.dateDuJour(lundi, creneau.jour_semaine));
};

const inscriptionsDe = (seanceId) => db.query(
    `SELECT user_id, statut, position_attente FROM inscriptions WHERE seance_id = ? ORDER BY statut DESC, position_attente, user_id`,
    [seanceId]
);

beforeAll(async () => {
    await app.locals.dbPrete;
    // Repartir d'un planning vide (l'initialisation crée des créneaux d'exemple)
    for (const table of ['inscriptions', 'waitlist_tokens', 'seances', 'bloc_creneaux', 'blocs', 'semaine_type_creneaux', 'creneaux']) {
        await db.run(`DELETE FROM ${table}`);
    }
    natation = (await db.get(`SELECT id FROM sports WHERE slug = 'natation'`)).id;
    velo = (await db.get(`SELECT id FROM sports WHERE slug = 'velo'`)).id;
    admin = { ...(await db.get(`SELECT id, role FROM users WHERE role = 'admin' LIMIT 1`)) };
    anne = await creerMembre('anne@x.fr');
    bruno = await creerMembre('bruno@x.fr');
    chloe = await creerMembre('chloe@x.fr', 'Loisir/Senior', 'jeune');
});

afterEach(async () => {
    for (const table of ['inscriptions', 'waitlist_tokens', 'seances', 'bloc_creneaux', 'blocs', 'semaine_type_creneaux', 'creneaux']) {
        await db.run(`DELETE FROM ${table}`);
    }
    await db.run(`UPDATE meta_rules_config SET enabled = 0`);
    for (const cle of Object.keys(mockSession)) delete mockSession[cle];
});

describe('GET /api/seances', () => {

    it('génère et renvoie les séances de la semaine, dans l\'ordre, filtrées par public', async () => {
        await creerCreneau({ nom: 'Dimanche natation', jour_semaine: 0, heure_debut: '09:00' });
        await creerCreneau({ nom: 'Lundi vélo', jour_semaine: 1, sport_id: velo, sans_limite: 1 });
        await creerCreneau({ nom: 'Mardi adultes', jour_semaine: 2, public_cible: 'adulte' });
        connecter(chloe);

        const res = await request(app).get('/api/seances?semaine=1');

        expect(res.status).toBe(200);
        const lundi = seances.lundiDeLaSemaine(1);
        expect(res.body.map(s => [s.nom, s.date_seance, s.jour_semaine])).toEqual([
            ['Lundi vélo', lundi, 1],
            ['Dimanche natation', seances.ajouterJours(lundi, 6), 0]
        ]);
        expect(res.body[0]).toMatchObject({ sans_limite: true, sport_slug: 'velo', inscrits: 0, est_passe: false });
    });

    it('limite les membres à deux semaines, les admins à quatre', async () => {
        connecter(anne);
        expect((await request(app).get('/api/seances?semaine=2')).status).toBe(400);
        expect((await request(app).get('/api/seances?semaine=-1')).status).toBe(400);

        connecter(admin);
        expect((await request(app).get('/api/seances?semaine=3')).status).toBe(200);
        expect((await request(app).get('/api/seances?semaine=4')).status).toBe(400);
    });

    it('signale un bloc déjà utilisé cette semaine par une autre séance', async () => {
        const c1 = await creerCreneau({ nom: 'Samedi', jour_semaine: 6 });
        const c2 = await creerCreneau({ nom: 'Dimanche', jour_semaine: 0 });
        const bloc = await db.run(`INSERT INTO blocs (nom, sport_id) VALUES ('Week-end', ?)`, [natation]);
        await db.run(`INSERT INTO bloc_creneaux (bloc_id, creneau_id) VALUES (?, ?), (?, ?)`, [bloc.lastID, c1, bloc.lastID, c2]);
        connecter(anne);
        const samedi = await seanceDe(c1, 1);
        expect((await request(app).post('/api/inscriptions').send({ seanceId: samedi.id })).status).toBe(200);

        const res = await request(app).get('/api/seances?semaine=1');

        expect(res.body.find(s => s.nom === 'Samedi').inscrit_dans_bloc).toBeNull();
        expect(res.body.find(s => s.nom === 'Dimanche').inscrit_dans_bloc).toBe('Samedi');
        // La semaine suivante reste libre
        connecter(admin);
        const semaine2 = await request(app).get('/api/seances?semaine=2');
        expect(semaine2.body.every(s => s.inscrit_dans_bloc === null)).toBe(true);
    });
});

describe('POST /api/inscriptions', () => {

    it('inscrit, puis place en liste d\'attente une fois la séance complète', async () => {
        const seance = await seanceDe(await creerCreneau({ capacite_max: 1 }), 1);

        connecter(anne);
        const r1 = await request(app).post('/api/inscriptions').send({ seanceId: seance.id });
        connecter(bruno);
        const r2 = await request(app).post('/api/inscriptions').send({ seanceId: seance.id });
        const doublon = await request(app).post('/api/inscriptions').send({ seanceId: seance.id });

        expect(r1.body.statut).toBe('inscrit');
        expect(r2.body).toMatchObject({ statut: 'attente', positionAttente: 1 });
        expect(doublon.status).toBe(400);
        expect(await inscriptionsDe(seance.id)).toEqual([
            { user_id: anne.id, statut: 'inscrit', position_attente: null },
            { user_id: bruno.id, statut: 'attente', position_attente: 1 }
        ]);
        const ligne = await db.get(`SELECT creneau_id, date_seance FROM inscriptions WHERE user_id = ?`, [anne.id]);
        expect(ligne).toEqual({ creneau_id: seance.creneau_id, date_seance: seance.date_seance });
    });

    it('accepte encore la forme créneau + date des anciennes pages', async () => {
        const creneau = await creerCreneau();
        const seance = await seanceDe(creneau, 1);
        connecter(anne);

        const res = await request(app).post('/api/inscriptions').send({ creneauId: creneau, date_seance: seance.date_seance });

        expect(res.status).toBe(200);
        expect(await inscriptionsDe(seance.id)).toHaveLength(1);
    });

    it('refuse les séances passées, annulées ou pas encore ouvertes', async () => {
        const creneau = await creerCreneau();
        connecter(anne);

        const lointaine = await seanceDe(creneau, 2);
        expect((await request(app).post('/api/inscriptions').send({ seanceId: lointaine.id })).body.error)
            .toBe('Les inscriptions à cette séance ne sont pas encore ouvertes');

        // Séance ayant déjà eu lieu (la génération ne crée rien dans le passé)
        const passee = { id: (await db.run(
            `INSERT INTO seances (creneau_id, date_seance, nom, sport_id, heure_debut, heure_fin, capacite_max)
             VALUES (?, ?, 'Créneau', ?, '10:00', '11:00', 1)`,
            [creneau, seances.dateDuJour(seances.lundiDeLaSemaine(-1), 0), natation]
        )).lastID };
        expect((await request(app).post('/api/inscriptions').send({ seanceId: passee.id })).body.error)
            .toBe('Cette séance est terminée');

        const annulee = await seanceDe(creneau, 1);
        await db.run(`UPDATE seances SET annulee = 1 WHERE id = ?`, [annulee.id]);
        expect((await request(app).post('/api/inscriptions').send({ seanceId: annulee.id })).body.error)
            .toBe('Cette séance est annulée');

        expect((await request(app).post('/api/inscriptions').send({ seanceId: 999999 })).status).toBe(404);
        expect((await request(app).post('/api/inscriptions').send({})).status).toBe(400);
    });

    it('applique le quota hebdomadaire du sport de la séance, semaine par semaine', async () => {
        // Quota Loisir/Senior natation : 3 séances par semaine
        const ids = [];
        for (const jour of [0, 1, 2, 3]) ids.push(await creerCreneau({ nom: `J${jour}`, jour_semaine: jour, capacite_max: 5 }));
        connecter(anne);

        const reponses = [];
        for (const id of ids) {
            reponses.push(await request(app).post('/api/inscriptions').send({ seanceId: (await seanceDe(id, 1)).id }));
        }

        expect(reponses.slice(0, 3).map(r => r.status)).toEqual([200, 200, 200]);
        expect(reponses[0].body.message).toContain('séance(s) de natation cette semaine');
        expect(reponses[3].status).toBe(400);
        expect(reponses[3].body.error).toContain('limite de 3 séances de natation');

        // Le vélo n'a pas de quota
        const velo1 = await seanceDe(await creerCreneau({ sport_id: velo, jour_semaine: 4 }), 1);
        expect((await request(app).post('/api/inscriptions').send({ seanceId: velo1.id })).status).toBe(200);
    });
});

describe('désinscription et liste d\'attente', () => {

    const remplir = async () => {
        const seance = await seanceDe(await creerCreneau({ capacite_max: 1 }), 1);
        for (const membre of [anne, bruno, chloe]) {
            connecter(membre);
            await request(app).post('/api/inscriptions').send({ seanceId: seance.id });
        }
        return seance;
    };

    it('prévient toute la liste d\'attente quand un inscrit se retire', async () => {
        const seance = await remplir();
        connecter(anne);

        const res = await request(app).delete(`/api/seances/${seance.id}/inscription`);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ notification: true, emailsEnvoyes: 2 });
        const jetons = await db.query(`SELECT user_id, seance_id, creneau_id, date_seance FROM waitlist_tokens ORDER BY user_id`);
        expect(jetons).toEqual([bruno, chloe].map(m => ({
            user_id: m.id, seance_id: seance.id, creneau_id: seance.creneau_id, date_seance: seance.date_seance
        })));
    });

    it('renumérote la liste quand une personne en attente se retire (forme créneau + date)', async () => {
        const seance = await remplir();
        connecter(bruno);

        const res = await request(app).delete(`/api/inscriptions/${seance.creneau_id}`).send({ date_seance: seance.date_seance });

        expect(res.body).toEqual({ message: 'Désinscription réussie' });
        expect(await inscriptionsDe(seance.id)).toEqual([
            { user_id: anne.id, statut: 'inscrit', position_attente: null },
            { user_id: chloe.id, statut: 'attente', position_attente: 1 }
        ]);
        expect((await request(app).delete(`/api/seances/${seance.id}/inscription`)).status).toBe(404);
    });

    it('donne la place au premier qui confirme via son lien, et refuse les suivants', async () => {
        const seance = await remplir();
        connecter(anne);
        await request(app).delete(`/api/seances/${seance.id}/inscription`);
        const jetons = await db.query(`SELECT token, user_id FROM waitlist_tokens ORDER BY user_id`);
        const jetonDe = (membre) => jetons.find(j => j.user_id === membre.id).token;

        const info = await request(app).get(`/api/inscription-attente/info/${jetonDe(chloe)}`);
        expect(info.body).toMatchObject({ creneau: 'Créneau', horaire: '10:00 - 11:00', date_seance: seance.date_seance });
        expect(info.body.jour).toMatch(/^Dimanche \d+ /);

        const premier = await request(app).post('/api/inscription-attente').send({ token: jetonDe(chloe) });
        expect(premier.body.success).toBe(true);
        expect(await inscriptionsDe(seance.id)).toEqual([
            { user_id: chloe.id, statut: 'inscrit', position_attente: null },
            { user_id: bruno.id, statut: 'attente', position_attente: 1 }
        ]);

        // Le lien de Bruno a été invalidé par la confirmation de Chloé
        const second = await request(app).post('/api/inscription-attente').send({ token: jetonDe(bruno) });
        expect(second.status).toBe(400);
    });

    it('refuse la confirmation si la séance est redevenue complète', async () => {
        const seance = await remplir();
        connecter(anne);
        await request(app).delete(`/api/seances/${seance.id}/inscription`);
        const { token } = await db.get(`SELECT token FROM waitlist_tokens WHERE user_id = ?`, [chloe.id]);
        connecter(anne);
        // Anne se réinscrit avant que Chloé ne confirme : la place est reprise
        await request(app).post('/api/inscriptions').send({ seanceId: seance.id });

        const res = await request(app).post('/api/inscription-attente').send({ token });

        expect(res.status).toBe(409);
        expect(res.body.tooLate).toBe(true);
    });
});

describe('administration des inscriptions d\'une séance', () => {

    it('liste, inscrit, promeut et retire des membres', async () => {
        const seance = await seanceDe(await creerCreneau({ capacite_max: 1 }), 0);
        connecter(bruno);
        await request(app).post('/api/inscriptions').send({ seanceId: seance.id });
        connecter(admin);

        const ajout = await request(app).post('/api/admin/inscriptions').send({ email: 'ANNE@x.fr', seanceId: seance.id });
        expect(ajout.status).toBe(200);
        expect((await request(app).post('/api/admin/inscriptions').send({ email: 'anne@x.fr', seanceId: seance.id })).status).toBe(400);
        expect((await request(app).post('/api/admin/inscriptions').send({ email: 'inconnu@x.fr', seanceId: seance.id })).status).toBe(404);

        // L'admin passe outre la capacité
        const liste = await request(app).get(`/api/admin/seances/${seance.id}/inscriptions`);
        expect(liste.body.seance).toMatchObject({ id: seance.id, date_seance: seance.date_seance });
        expect(liste.body.inscriptions.map(i => [i.email, i.statut])).toEqual([
            ['bruno@x.fr', 'inscrit'], ['anne@x.fr', 'inscrit']
        ]);

        await db.run(`INSERT INTO inscriptions (user_id, creneau_id, seance_id, date_seance, statut, position_attente) VALUES (?, ?, ?, ?, 'attente', 1)`,
            [chloe.id, seance.creneau_id, seance.id, seance.date_seance]);
        const promotion = await request(app).put(`/api/admin/seances/${seance.id}/inscriptions/${chloe.id}/promote`);
        expect(promotion.status).toBe(200);

        const retrait = await request(app).delete(`/api/admin/seances/${seance.id}/inscriptions/${bruno.id}`);
        expect(retrait.status).toBe(200);
        expect(await inscriptionsDe(seance.id)).toEqual([
            { user_id: anne.id, statut: 'inscrit', position_attente: null },
            { user_id: chloe.id, statut: 'inscrit', position_attente: null }
        ]);
        expect((await request(app).delete(`/api/admin/seances/${seance.id}/inscriptions/${bruno.id}`)).status).toBe(404);
    });

    it('réserve ces routes aux administrateurs', async () => {
        const seance = await seanceDe(await creerCreneau(), 0);
        connecter(anne);

        expect((await request(app).get(`/api/admin/seances/${seance.id}/inscriptions`)).status).toBe(403);
        expect((await request(app).delete(`/api/admin/seances/${seance.id}/inscriptions/${bruno.id}`)).status).toBe(403);
    });
});

describe('modification et suppression d\'un créneau', () => {

    const modification = { nom: 'Renfo', jour_semaine: 6, heure_debut: '20:00', heure_fin: '21:00' };

    it('reporte les changements sur les séances à venir et repourvoit la liste d\'attente', async () => {
        const creneau = await creerCreneau({ capacite_max: 1, jour_semaine: 0 });
        const seance = await seanceDe(creneau, 1);
        for (const membre of [anne, bruno, chloe]) {
            connecter(membre);
            await request(app).post('/api/inscriptions').send({ seanceId: seance.id });
        }
        connecter(admin);

        const res = await request(app).put(`/api/creneaux/${creneau}`).send({ ...modification, sport_id: natation, capacite_max: 2 });

        expect(res.status).toBe(200);
        expect(res.body.promus).toBe(1);
        const apres = await seances.trouverSeance(db, seance.id);
        expect(apres).toMatchObject({ nom: 'Renfo', heure_debut: '20:00', capacite_max: 2, jour_semaine: 6 });
        expect(await inscriptionsDe(seance.id)).toEqual([
            { user_id: anne.id, statut: 'inscrit', position_attente: null },
            { user_id: bruno.id, statut: 'inscrit', position_attente: null },
            { user_id: chloe.id, statut: 'attente', position_attente: 1 }
        ]);
        const dates = await db.query(`SELECT DISTINCT date_seance FROM inscriptions WHERE seance_id = ?`, [seance.id]);
        expect(dates).toEqual([{ date_seance: apres.date_seance }]);
    });

    it('refuse de supprimer un créneau qui a des inscrits, sauf suppression forcée', async () => {
        const creneau = await creerCreneau();
        const seance = await seanceDe(creneau, 1);
        connecter(anne);
        await request(app).post('/api/inscriptions').send({ seanceId: seance.id });
        connecter(admin);

        const refus = await request(app).delete(`/api/creneaux/${creneau}`);
        expect(refus.status).toBe(400);
        expect(refus.body.error).toContain('1 personne(s)');

        const force = await request(app).delete(`/api/creneaux/${creneau}/force`);
        expect(force.status).toBe(200);
        expect((await db.get(`SELECT COUNT(*) AS n FROM seances WHERE creneau_id = ?`, [creneau])).n).toBe(0);
        expect((await db.get(`SELECT COUNT(*) AS n FROM inscriptions`)).n).toBe(0);
    });

    it('supprime un créneau sans inscrits avec ses séances', async () => {
        const creneau = await creerCreneau();
        await seanceDe(creneau, 0);
        await seanceDe(creneau, 1);
        connecter(admin);

        expect((await request(app).delete(`/api/creneaux/${creneau}`)).status).toBe(200);
        expect((await db.get(`SELECT COUNT(*) AS n FROM seances`)).n).toBe(0);
    });

    it('expose la séance de la semaine dans la liste des créneaux (administration)', async () => {
        const creneau = await creerCreneau({ nom: 'Modèle' });
        connecter(admin);

        const res = await request(app).get('/api/creneaux');
        const seance = await seanceDe(creneau, 0);

        expect(res.body).toHaveLength(1);
        expect(res.body[0]).toMatchObject({ id: creneau, seance_id: seance.id, date_seance: seance.date_seance, inscrits: 0 });
    });
});

describe('vues du membre', () => {

    it('liste ses inscriptions par date et compte son quota sur la semaine consultée', async () => {
        const dimanche = await creerCreneau({ nom: 'Dimanche', jour_semaine: 0, capacite_max: 5 });
        const lundi = await creerCreneau({ nom: 'Lundi', jour_semaine: 1, capacite_max: 5 });
        connecter(anne);
        for (const [creneau, semaine] of [[dimanche, 1], [lundi, 1], [dimanche, 0]]) {
            await request(app).post('/api/inscriptions').send({ seanceId: (await seanceDe(creneau, semaine)).id });
        }

        const mes = await request(app).get('/api/mes-inscriptions');
        expect(mes.body.map(i => [i.nom, i.jour_semaine])).toEqual([['Dimanche', 0], ['Lundi', 1], ['Dimanche', 0]]);
        expect(mes.body[0].seance_id).toEqual(expect.any(Number));

        const limitesSemaine1 = await request(app).get('/api/mes-limites?semaine=1');
        expect(limitesSemaine1.body[0]).toMatchObject({ sportNom: 'Natation', seancesActuelles: 2 });
        const limitesSemaine0 = await request(app).get('/api/mes-limites');
        expect(limitesSemaine0.body[0].seancesActuelles).toBe(1);
    });

    it('affiche les inscrits d\'une séance, par séance ou par créneau + date', async () => {
        const creneau = await creerCreneau();
        const seance = await seanceDe(creneau, 1);
        connecter(anne);
        await request(app).post('/api/inscriptions').send({ seanceId: seance.id });

        const parSeance = await request(app).get(`/api/seances/${seance.id}/inscrits`);
        const parCreneau = await request(app).get(`/api/creneaux/${creneau}/inscrits?date_seance=${seance.date_seance}`);

        expect(parSeance.body).toEqual([{ nom: 'Nom', prenom: 'anne', statut: 'inscrit', position_attente: null }]);
        expect(parCreneau.body).toEqual(parSeance.body);
        expect((await request(app).get('/api/seances/999999/inscrits')).status).toBe(404);
    });

    it("remet à zéro la semaine en cours d'un seul sport, sans toucher aux semaines suivantes", async () => {
        // Dimanche : toujours à venir dans la semaine en cours
        const nat = await seanceDe(await creerCreneau({ jour_semaine: 0 }), 0);
        const creneauVelo = await creerCreneau({ jour_semaine: 0, sport_id: velo, heure_debut: '14:00' });
        const vel = await seanceDe(creneauVelo, 0);
        const velSuivante = await seanceDe(creneauVelo, 1);
        connecter(anne);
        for (const seance of [nat, vel, velSuivante]) {
            await request(app).post('/api/inscriptions').send({ seanceId: seance.id });
        }
        connecter(admin);

        const res = await request(app).post('/api/admin/reset-weekly').send({ sport_id: velo });

        expect(res.body.inscriptionsSupprimes).toBe(1);
        expect(await inscriptionsDe(nat.id)).toHaveLength(1);
        expect(await inscriptionsDe(vel.id)).toHaveLength(0);
        expect(await inscriptionsDe(velSuivante.id)).toHaveLength(1);
    });
});