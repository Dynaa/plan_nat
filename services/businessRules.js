// services/businessRules.js

const { normaliserDate, jourSemaineDe, lundiDe, dateDuJour } = require('./seances');

// Le périmètre des quotas est désormais porté par la base : une ligne dans
// licence_limits pour un couple (licence, sport) impose une limite, son absence
// signifie « sans restriction ». En pratique seule la natation en a, mais
// ajouter un quota à un autre sport ne demande plus de changer le code.

// Bornes (lundi → dimanche) de la semaine contenant la date donnée.
// Le quota se compte par semaine calendaire, pas sur l'ensemble des inscriptions.
const bornesSemaine = (dateRef) => {
    const date = dateRef ? new Date(dateRef) : new Date();

    let jour = date.getUTCDay();
    if (jour === 0) jour = 7; // dimanche = fin de semaine

    const lundi = new Date(date);
    lundi.setUTCDate(date.getUTCDate() - (jour - 1));

    const dimanche = new Date(lundi);
    dimanche.setUTCDate(lundi.getUTCDate() + 6);

    return {
        debut: lundi.toISOString().split('T')[0],
        fin: dimanche.toISOString().split('T')[0]
    };
};

// Limite hebdomadaire d'un utilisateur pour un sport donné.
// Renvoie limiteApplicable: false quand aucun quota n'est configuré pour ce
// couple (licence, sport) — le sport est alors libre d'accès.
const verifierLimitesSeances = async (db, userId, sportId, dateSeance = null) => {
    const { debut, fin } = bornesSemaine(dateSeance);

    try {
        const user = await db.get(
            db.adaptSQL(
                `SELECT licence_type FROM users WHERE id = ?`,
                `SELECT licence_type FROM users WHERE id = $1`
            ),
            [userId]
        );

        if (!user) {
            throw new Error('Utilisateur non trouvé');
        }

        if (!sportId) {
            return { limiteApplicable: false, licenceType: user.licence_type };
        }

        const limite = await db.get(
            db.adaptSQL(
                `SELECT max_seances_semaine FROM licence_limits WHERE licence_type = ? AND sport_id = ?`,
                `SELECT max_seances_semaine FROM licence_limits WHERE licence_type = $1 AND sport_id = $2`
            ),
            [user.licence_type, sportId]
        );

        // Aucun quota configuré pour ce sport : accès libre
        if (!limite) {
            return { limiteApplicable: false, licenceType: user.licence_type };
        }

        const compte = await db.get(
            db.adaptSQL(
                `SELECT COUNT(i.id) as seances
                 FROM inscriptions i
                 JOIN seances s ON i.seance_id = s.id
                 WHERE i.user_id = ? AND i.statut = 'inscrit'
                   AND s.date_seance BETWEEN ? AND ?
                   AND s.sport_id = ?`,
                `SELECT COUNT(i.id) as seances
                 FROM inscriptions i
                 JOIN seances s ON i.seance_id = s.id
                 WHERE i.user_id = $1 AND i.statut = 'inscrit'
                   AND s.date_seance BETWEEN $2 AND $3
                   AND s.sport_id = $4`
            ),
            [userId, debut, fin, sportId]
        );

        const maxSeances = parseInt(limite.max_seances_semaine, 10);
        const seancesActuelles = parseInt(compte ? compte.seances : 0) || 0;

        return {
            limiteApplicable: true,
            licenceType: user.licence_type,
            maxSeances,
            seancesActuelles,
            limiteAtteinte: seancesActuelles >= maxSeances,
            seancesRestantes: Math.max(0, maxSeances - seancesActuelles)
        };
    } catch (err) {
        console.error('Erreur lors de la vérification des limites:', err);
        throw err;
    }
};

// Sport auquel appartient un créneau (null si le créneau n'en a pas)
const sportDuCreneau = async (db, creneauId) => {
    const creneau = await db.get(
        db.adaptSQL(
            `SELECT sport_id FROM creneaux WHERE id = ?`,
            `SELECT sport_id FROM creneaux WHERE id = $1`
        ),
        [creneauId]
    );

    return creneau ? creneau.sport_id : null;
};

const JOURS_NOMS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

// Règle de bloc : une seule séance par bloc dans la semaine de la séance visée.
// Le bloc est celui du créneau dont la séance est issue ; une séance
// ponctuelle n'appartient à aucun bloc.
const verifierRegleBloc = async (db, userId, seance) => {
    try {
        if (!seance.creneau_id) {
            return { autorise: true, message: null, blocNom: null, creneauExistant: null };
        }

        const bloc = await db.get(
            `SELECT b.id, b.nom FROM blocs b
             JOIN bloc_creneaux bc ON b.id = bc.bloc_id
             WHERE bc.creneau_id = ?`,
            [seance.creneau_id]
        );

        if (!bloc) {
            return { autorise: true, message: null, blocNom: null, creneauExistant: null };
        }

        const { debut, fin } = bornesSemaine(seance.date_seance);
        const inscriptionExistante = await db.get(
            `SELECT s.id, s.nom, s.date_seance, s.heure_debut
             FROM inscriptions i
             JOIN seances s ON i.seance_id = s.id
             JOIN bloc_creneaux bc ON bc.creneau_id = s.creneau_id
             WHERE i.user_id = ?
               AND bc.bloc_id = ?
               AND s.id != ?
               AND i.statut = 'inscrit'
               AND s.date_seance BETWEEN ? AND ?
             LIMIT 1`,
            [userId, bloc.id, seance.id, debut, fin]
        );

        if (inscriptionExistante) {
            const jour = JOURS_NOMS[jourSemaineDe(normaliserDate(inscriptionExistante.date_seance))];
            return {
                autorise: false,
                message: `Vous êtes déjà inscrit au créneau « ${inscriptionExistante.nom} » (${jour} ${inscriptionExistante.heure_debut}) dans le bloc « ${bloc.nom} ». Un seul créneau par bloc est autorisé.`,
                blocNom: bloc.nom,
                creneauExistant: inscriptionExistante.nom
            };
        }

        return { autorise: true, message: null, blocNom: bloc.nom, creneauExistant: null };
    } catch (err) {
        console.error('Erreur lors de la vérification de la règle de bloc:', err);
        return { autorise: false, message: "Erreur lors de la vérification des règles d'inscription" };
    }
};

// Méta-règles : une inscription un jour donné en interdit d'autres, la même
// semaine et dans le même sport.
const verifierMetaRegles = async (db, userId, seance) => {
    try {
        const config = await db.get(
            `SELECT enabled FROM meta_rules_config LIMIT 1`
        );

        if (!config || !config.enabled) {
            return { autorise: true, message: null };
        }

        const user = await db.get(`SELECT licence_type FROM users WHERE id = ?`, [userId]);

        if (!user) {
            return { autorise: false, message: "Utilisateur non trouvé" };
        }

        // Les méta-règles sont propres à un sport : une règle natation ne doit pas
        // interdire une sortie vélo le même jour.
        const metaRegles = await db.query(
            `SELECT jour_source, jours_interdits, description
             FROM meta_rules
             WHERE licence_type = ? AND sport_id = ? AND active = true`,
            [user.licence_type, seance.sport_id]
        );

        if (!metaRegles || metaRegles.length === 0) {
            return { autorise: true, message: null };
        }

        const date = normaliserDate(seance.date_seance);
        const jourCible = jourSemaineDe(date);
        const lundi = lundiDe(date);

        for (const regle of metaRegles) {
            // Jours interdits en CSV "4,6" ou en JSON "[4,6]"
            let joursInterdits = [];
            try {
                if (regle.jours_interdits.startsWith('[')) {
                    joursInterdits = JSON.parse(regle.jours_interdits);
                } else {
                    joursInterdits = regle.jours_interdits.split(',').map(j => parseInt(j.trim()));
                }
            } catch (e) {
                console.error('Erreur parsing jours_interdits:', e);
                continue;
            }

            if (!joursInterdits.includes(jourCible)) continue;

            // L'inscription déclenchante : même sport, jour source de la même semaine
            const inscriptionSource = await db.get(
                `SELECT i.id FROM inscriptions i
                 JOIN seances s ON i.seance_id = s.id
                 WHERE i.user_id = ?
                   AND s.date_seance = ?
                   AND s.sport_id = ?
                   AND i.statut = 'inscrit'
                 LIMIT 1`,
                [userId, dateDuJour(lundi, regle.jour_source), seance.sport_id]
            );

            if (inscriptionSource) {
                return {
                    autorise: false,
                    message: `Inscription interdite : vous êtes déjà inscrit à un créneau le ${JOURS_NOMS[regle.jour_source]}. ${regle.description || ''}`
                };
            }
        }

        return { autorise: true, message: null };
    } catch (err) {
        console.error('Erreur lors de la vérification des méta-règles:', err);
        return { autorise: false, message: "Erreur lors de la vérification des règles" };
    }
};
module.exports = {
    verifierLimitesSeances,
    verifierRegleBloc,
    verifierMetaRegles,
    sportDuCreneau,
    bornesSemaine
};
