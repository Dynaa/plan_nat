// Vérification des séances datées sur PostgreSQL.
//
// Les tests automatiques tournent sur SQLite ; ce script rejoue les parcours
// principaux sur une vraie base PostgreSQL, comme en production. Il écrit
// dans la base : ne l'utilisez QUE sur une base jetable.
//
//   createdb plan_nat_test
//   DATABASE_URL=postgres://<utilisateur>@localhost:5432/plan_nat_test node scripts/verifier-seances-postgres.js
//
// Le nom de la base doit contenir « test » : garde-fou contre une erreur de cible.

const url = process.env.DATABASE_URL;
const nomBase = url ? new URL(url).pathname.slice(1) : '';
if (!url || !/test/i.test(nomBase) || process.env.NODE_ENV === 'production') {
    console.error('❌ Indiquez dans DATABASE_URL une base PostgreSQL jetable dont le nom contient « test ».');
    process.exit(1);
}
process.env.NODE_ENV = 'development'; // comptes de démonstration, sans les simulations des tests

const request = require('supertest');
const app = require('../server');
const seances = require('../services/seances');
const db = app.locals.db;

let echecs = 0;
const verifier = (libelle, condition, detail) => {
    console.log(`${condition ? '✅' : '❌'} ${libelle}${condition || detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
    if (!condition) echecs++;
};

const connexion = async (email, password) => {
    const agent = request.agent(app);
    const res = await agent.post('/api/login').send({ email, password });
    if (res.status !== 200) throw new Error(`Connexion impossible pour ${email} : ${JSON.stringify(res.body)}`);
    return agent;
};

(async () => {
    await app.locals.dbPrete;
    // Repartir d'un planning propre si le script a déjà tourné
    for (const table of ['inscriptions', 'waitlist_tokens', 'seances']) await db.run(`DELETE FROM ${table}`);

    await seances.migrer(db);
    verifier('migration relancée sans erreur', true);

    // Comptes de démonstration créés à l'initialisation en développement
    const membre = await connexion('test@triathlon.com', 'test123');
    const admin = await connexion(process.env.ADMIN_EMAIL || 'admin@triathlon.com', process.env.ADMIN_PASSWORD || 'admin123');

    const liste = await membre.get('/api/seances?semaine=1');
    verifier('liste des séances de la semaine prochaine', liste.status === 200 && liste.body.length > 0, liste.body);
    verifier('dates au format AAAA-MM-JJ', liste.body.every(s => /^\d{4}-\d{2}-\d{2}$/.test(s.date_seance)), liste.body[0]);
    verifier('semaine hors fenêtre refusée', (await membre.get('/api/seances?semaine=2')).status === 400);

    const regeneration = await seances.genererSemaine(db, seances.lundiDeLaSemaine(1));
    verifier('génération idempotente (ON CONFLICT)', regeneration === 0, regeneration);

    const seance = liste.body[0];
    const inscription = await membre.post('/api/inscriptions').send({ seanceId: seance.id });
    verifier('inscription à une séance', inscription.status === 200, inscription.body);
    verifier('doublon refusé', (await membre.post('/api/inscriptions').send({ seanceId: seance.id })).status === 400);

    const mes = await membre.get('/api/mes-inscriptions');
    verifier('mes inscriptions', mes.status === 200 && mes.body.some(i => i.seance_id === seance.id && i.date_seance === seance.date_seance), mes.body);

    const limites = await membre.get('/api/mes-limites?semaine=1');
    verifier('quota de la semaine', limites.status === 200 && limites.body.some(l => l.seancesActuelles >= 1), limites.body);

    const inscrits = await membre.get(`/api/seances/${seance.id}/inscrits`);
    verifier('inscrits de la séance', inscrits.status === 200 && inscrits.body.length === 1, inscrits.body);
    const inscritsAncienneForme = await membre.get(`/api/creneaux/${seance.creneau_id}/inscrits?date_seance=${seance.date_seance}`);
    verifier('inscrits, ancienne forme créneau + date', inscritsAncienneForme.status === 200 && inscritsAncienneForme.body.length === 1, inscritsAncienneForme.body);

    const creneaux = await admin.get('/api/creneaux');
    verifier('liste admin des créneaux avec leur séance', creneaux.status === 200 && creneaux.body.every(c => c.seance_id), creneaux.body[0]);

    // Séance complète → liste d'attente → désinscription → jeton d'attente
    await db.run(`UPDATE seances SET capacite_max = 1 WHERE id = ?`, [seance.id]);
    const ajout = await admin.post('/api/admin/inscriptions').send({ email: 'testenfant@triathlon.com', seanceId: seance.id });
    verifier('inscription par l\'admin', ajout.status === 200, ajout.body);
    const enfant = await db.get(`SELECT id FROM users WHERE email = 'testenfant@triathlon.com'`);
    await db.run(`UPDATE inscriptions SET statut = 'attente', position_attente = 1 WHERE user_id = ? AND seance_id = ?`, [enfant.id, seance.id]);

    const depart = await membre.delete(`/api/seances/${seance.id}/inscription`);
    verifier('désinscription', depart.status === 200, depart.body);
    const jeton = await db.get(`SELECT token, date_seance FROM waitlist_tokens WHERE seance_id = ?`, [seance.id]);
    verifier('jeton de liste d\'attente créé avec sa date', !!jeton && seances.normaliserDate(jeton.date_seance) === seance.date_seance, jeton);

    if (jeton) {
        const info = await request(app).get(`/api/inscription-attente/info/${jeton.token}`);
        verifier('infos du jeton', info.status === 200 && info.body.date_seance === seance.date_seance, info.body);
        const confirmation = await request(app).post('/api/inscription-attente').send({ token: jeton.token });
        verifier('confirmation via le jeton', confirmation.status === 200, confirmation.body);
    }

    const vue = await admin.get(`/api/admin/seances/${seance.id}/inscriptions`);
    verifier('vue admin de la séance', vue.status === 200 && vue.body.inscriptions.length === 1, vue.body);

    // Modification du créneau : report sur la séance et promotion
    await membre.post('/api/inscriptions').send({ seanceId: seance.id }); // en attente
    const creneau = await db.get(`SELECT * FROM creneaux WHERE id = ?`, [seance.creneau_id]);
    const modif = await admin.put(`/api/creneaux/${creneau.id}`).send({
        nom: `${creneau.nom} (modifié)`, sport_id: creneau.sport_id, jour_semaine: creneau.jour_semaine,
        heure_debut: creneau.heure_debut, heure_fin: creneau.heure_fin, capacite_max: 5, public_cible: creneau.public_cible
    });
    verifier('modification du créneau', modif.status === 200 && modif.body.promus === 1, modif.body);
    const apres = await seances.trouverSeance(db, seance.id);
    verifier('séance à venir synchronisée', apres.nom.endsWith('(modifié)') && apres.capacite_max === 5, apres);

    // Semaines types : duplication, application avec correspondance, retour
    const types = await admin.get('/api/admin/semaines-types');
    const standard = types.body.find(t => t.par_defaut);
    verifier('semaine type par défaut présente', types.status === 200 && !!standard, types.body);
    const copie = await admin.post('/api/admin/semaines-types').send({ nom: `Vérification ${Date.now()}`, source_id: standard.id });
    verifier('duplication d\'une semaine type', copie.status === 200 && copie.body.semaine_type.nb_creneaux > 0, copie.body);
    const copieId = copie.body.semaine_type.id;
    const lundi1 = seances.lundiDeLaSemaine(1);

    const apercu = await admin.post(`/api/admin/semaines/${lundi1}`).send({ semaine_type_id: copieId, simulation: true });
    verifier('aperçu : tout se conserve vers une copie', apercu.status === 200 && apercu.body.bilan.annulees.length === 0, apercu.body);
    const application = await admin.post(`/api/admin/semaines/${lundi1}`).send({ semaine_type_id: copieId });
    verifier('application de la copie', application.status === 200, application.body);
    const planningSemaines = await admin.get('/api/admin/semaines');
    verifier('planning : choix enregistré', planningSemaines.body[1].explicite && planningSemaines.body[1].semaine_type_id === copieId, planningSemaines.body);
    const retour = await admin.post(`/api/admin/semaines/${lundi1}`).send({ semaine_type_id: standard.id });
    verifier('retour à la semaine type initiale', retour.status === 200 && retour.body.bilan.annulees.length === 0, retour.body);
    const defaut = await admin.put(`/api/admin/semaines-types/${copieId}/defaut`);
    verifier('changement de semaine type par défaut', defaut.status === 200, defaut.body);
    const remise = await admin.put(`/api/admin/semaines-types/${standard.id}/defaut`);
    verifier('rétablissement du défaut', remise.status === 200, remise.body);

    // Reprise d'une inscription héritée (sans séance)
    const semaineSuivante = seances.lundiDeLaSemaine(1);
    const autre = liste.body.find(s => s.creneau_id !== seance.creneau_id);
    await db.run(`DELETE FROM seances WHERE id = ?`, [autre.id]);
    await db.run(
        `INSERT INTO inscriptions (user_id, creneau_id, date_seance, statut) VALUES (?, ?, ?, 'inscrit')`,
        [enfant.id, autre.creneau_id, autre.date_seance]
    );
    await seances.migrer(db);
    const reprise = await db.get(`SELECT seance_id FROM inscriptions WHERE user_id = ? AND creneau_id = ?`, [enfant.id, autre.creneau_id]);
    verifier('inscription héritée rattachée à une séance recréée', !!(reprise && reprise.seance_id), reprise);
    const semaine = await seances.listerSeances(db, { debut: semaineSuivante, fin: seances.ajouterJours(semaineSuivante, 6) });
    verifier('séance recréée dans sa semaine', semaine.filter(s => s.creneau_id === autre.creneau_id).length === 1, semaine);

    const reset = await admin.post('/api/admin/reset-weekly').send({ sport_id: seance.sport_id });
    verifier('remise à zéro par sport', reset.status === 200, reset.body);

    const suppression = await admin.delete(`/api/creneaux/${autre.creneau_id}/force`);
    verifier('suppression forcée d\'un créneau', suppression.status === 200, suppression.body);

    console.log(echecs === 0 ? '\n🎉 Tout est conforme sur PostgreSQL' : `\n⚠️ ${echecs} vérification(s) en échec`);
    await db.pool.end();
    process.exit(echecs === 0 ? 0 : 1);
})().catch(async (err) => {
    console.error('❌ Erreur inattendue :', err);
    process.exit(1);
});