// services/seancesAdmin.js

// Ajustements d'une séance précise par un admin : modification, annulation,
// rétablissement, séance ponctuelle. Les emails restent à l'appelant, qui
// reçoit la liste des personnes à prévenir.

const seances = require('./seances');

// Motif d'une annulation décidée par un admin (affichée aux membres)
const MOTIF_ADMIN = 'admin';

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PUBLICS = ['jeune', 'adulte', 'les deux'];

class ErreurSeance extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
        this.metier = true;
    }
}

const inscritsDe = (db, seanceId) => db.query(
    `SELECT i.user_id, i.statut, u.email, u.nom, u.prenom
     FROM inscriptions i JOIN users u ON u.id = i.user_id
     WHERE i.seance_id = ?
     ORDER BY i.statut DESC, i.position_attente`,
    [seanceId]
);

// Une séance se place entre aujourd'hui et la fin du planning
const verifierDate = (date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
        throw new ErreurSeance('Date invalide');
    }
    if (date < seances.aujourdhuiIso()) {
        throw new ErreurSeance('Impossible de placer une séance dans le passé');
    }
    const fin = seances.ajouterJours(seances.lundiDeLaSemaine(seances.SEMAINES_ADMIN - 1), 6);
    if (date > fin) {
        throw new ErreurSeance(`Seules les ${seances.SEMAINES_ADMIN} prochaines semaines se planifient`);
    }
};

// Réglages saisis, nettoyés et validés. `capacite_max` est déjà résolue par
// l'appelant (capacité directe, lignes d'eau ou capacité par défaut du sport).
const reglagesValides = (champs) => {
    const nom = String(champs.nom ?? '').trim();
    if (!nom) throw new ErreurSeance('Le nom de la séance est requis');

    const { heure_debut, heure_fin } = champs;
    if (!HEURE.test(heure_debut || '') || !HEURE.test(heure_fin || '')) {
        throw new ErreurSeance('Horaires invalides (HH:MM)');
    }
    if (heure_fin <= heure_debut) {
        throw new ErreurSeance("L'heure de fin doit suivre l'heure de début");
    }

    const sansLimite = seances.estVrai(champs.sans_limite);
    const capacite = parseInt(champs.capacite_max, 10) || 0;
    if (!sansLimite && capacite < 1) {
        throw new ErreurSeance('Indiquez une capacité, ou un nombre de lignes et de personnes par ligne');
    }

    return {
        nom,
        heure_debut,
        heure_fin,
        capacite_max: capacite,
        sans_limite: sansLimite,
        lieu: String(champs.lieu ?? '').trim() || null,
        nombre_lignes: parseInt(champs.nombre_lignes, 10) || null,
        personnes_par_ligne: parseInt(champs.personnes_par_ligne, 10) || null,
        public_cible: PUBLICS.includes(champs.public_cible) ? champs.public_cible : 'les deux'
    };
};

const COLONNES = ['nom', 'heure_debut', 'heure_fin', 'capacite_max', 'sans_limite', 'lieu',
    'nombre_lignes', 'personnes_par_ligne', 'public_cible'];

const seanceAVenir = async (db, seanceId) => {
    const seance = await seances.trouverSeance(db, seanceId);
    if (!seance) throw new ErreurSeance('Séance non trouvée', 404);
    if (seance.date_seance < seances.aujourdhuiIso()) throw new ErreurSeance('Cette séance est passée');
    return seance;
};

// Ajuste une séance, qui ne suivra plus les modifications de son créneau.
// Une séance issue d'un créneau ne change de jour que dans sa semaine : c'est
// là que la semaine type la retrouve.
// Renvoie { seance, changements, inscrits, gainDePlaces } ; `inscrits` n'est
// rempli que si un changement (date, horaire, lieu) les concerne.
const modifierSeance = async (db, seanceId, champs) => {
    const avant = await seanceAVenir(db, seanceId);
    if (avant.annulee) {
        throw new ErreurSeance('Cette séance est annulée : rétablissez-la avant de la modifier');
    }

    const reglages = reglagesValides(champs);
    const date = champs.date_seance ? seances.normaliserDate(champs.date_seance) : avant.date_seance;
    if (date !== avant.date_seance) {
        verifierDate(date);
        if (avant.creneau_id && seances.lundiDe(date) !== seances.lundiDe(avant.date_seance)) {
            throw new ErreurSeance("Une séance issue d'un créneau ne peut changer de jour que dans sa semaine");
        }
    }

    await db.run(
        `UPDATE seances SET ${COLONNES.map(c => `${c} = ?`).join(', ')}, date_seance = ?, modifiee = true WHERE id = ?`,
        [...COLONNES.map(c => reglages[c]), date, seanceId]
    );
    if (date !== avant.date_seance) {
        await db.run(`UPDATE inscriptions SET date_seance = ? WHERE seance_id = ?`, [date, seanceId]);
        await db.run(`UPDATE waitlist_tokens SET date_seance = ? WHERE seance_id = ?`, [date, seanceId]);
    }

    const changements = [];
    if (date !== avant.date_seance) {
        changements.push({ libelle: 'Date', avant: avant.date_seance, apres: date, type: 'date' });
    }
    if (reglages.heure_debut !== avant.heure_debut || reglages.heure_fin !== avant.heure_fin) {
        changements.push({
            libelle: 'Horaire',
            avant: `${avant.heure_debut} - ${avant.heure_fin}`,
            apres: `${reglages.heure_debut} - ${reglages.heure_fin}`
        });
    }
    if ((avant.lieu || null) !== reglages.lieu) {
        changements.push({ libelle: 'Lieu', avant: avant.lieu || 'non précisé', apres: reglages.lieu || 'non précisé' });
    }

    return {
        seance: await seances.trouverSeance(db, seanceId),
        changements,
        inscrits: changements.length > 0 ? await inscritsDe(db, seanceId) : [],
        gainDePlaces: (reglages.sans_limite && !avant.sans_limite)
            || (!reglages.sans_limite && reglages.capacite_max > avant.capacite_max)
    };
};

// Annule une séance : ses inscrits (et la liste d'attente) sont retirés.
// Renvoie { seance, inscrits } pour les prévenir.
const annulerSeance = async (db, seanceId) => {
    const seance = await seanceAVenir(db, seanceId);
    if (seance.annulee) throw new ErreurSeance('Cette séance est déjà annulée');

    const inscrits = await inscritsDe(db, seanceId);
    await db.run(`DELETE FROM waitlist_tokens WHERE seance_id = ?`, [seanceId]);
    await db.run(`DELETE FROM inscriptions WHERE seance_id = ?`, [seanceId]);
    await db.run(`UPDATE seances SET annulee = true, motif_annulation = ? WHERE id = ?`, [MOTIF_ADMIN, seanceId]);

    return { seance: await seances.trouverSeance(db, seanceId), inscrits };
};

// Rétablit une séance annulée par un admin. Celles retirées par un changement
// de semaine type reviennent en réappliquant la semaine type concernée.
const retablirSeance = async (db, seanceId) => {
    const seance = await seanceAVenir(db, seanceId);
    if (!seance.annulee) throw new ErreurSeance("Cette séance n'est pas annulée");
    if (seance.motif_annulation !== MOTIF_ADMIN) {
        throw new ErreurSeance('Cette séance a été retirée par un changement de semaine type : réappliquez la semaine type qui la contient');
    }

    await db.run(`UPDATE seances SET annulee = false, motif_annulation = NULL WHERE id = ?`, [seanceId]);
    return seances.trouverSeance(db, seanceId);
};

// Séance hors semaine type (stage, sortie exceptionnelle…)
const creerSeancePonctuelle = async (db, champs) => {
    const date = seances.normaliserDate(champs.date_seance);
    verifierDate(date);

    const sport = champs.sport_id ? await db.get(`SELECT id FROM sports WHERE id = ?`, [champs.sport_id]) : null;
    if (!sport) throw new ErreurSeance('Sport requis');

    const reglages = reglagesValides(champs);
    const colonnes = ['sport_id', 'date_seance', 'modifiee', ...COLONNES];
    const resultat = await db.run(
        db.adaptSQL(
            `INSERT INTO seances (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`,
            `INSERT INTO seances (${colonnes.join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')}) RETURNING id`
        ),
        [sport.id, date, true, ...COLONNES.map(c => reglages[c])]
    );
    return seances.trouverSeance(db, resultat.lastID);
};

module.exports = {
    MOTIF_ADMIN,
    ErreurSeance,
    modifierSeance,
    annulerSeance,
    retablirSeance,
    creerSeancePonctuelle
};