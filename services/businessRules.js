// services/businessRules.js

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
                 JOIN creneaux c ON i.creneau_id = c.id
                 WHERE i.user_id = ? AND i.statut = 'inscrit'
                   AND i.date_seance BETWEEN ? AND ?
                   AND c.sport_id = ?`,
                `SELECT COUNT(i.id) as seances
                 FROM inscriptions i
                 JOIN creneaux c ON i.creneau_id = c.id
                 WHERE i.user_id = $1 AND i.statut = 'inscrit'
                   AND i.date_seance BETWEEN $2 AND $3
                   AND c.sport_id = $4`
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

// Vérifier la règle de bloc : un utilisateur ne peut s'inscrire qu'à 1 séance par bloc
const verifierRegleBloc = async (db, userId, creneauId) => {
    try {
        // Trouver le bloc auquel appartient ce créneau
        const bloc = await db.get(
            db.isPostgres
                ? `SELECT b.id, b.nom FROM blocs b
                   JOIN bloc_creneaux bc ON b.id = bc.bloc_id
                   WHERE bc.creneau_id = $1`
                : `SELECT b.id, b.nom FROM blocs b
                   JOIN bloc_creneaux bc ON b.id = bc.bloc_id
                   WHERE bc.creneau_id = ?`,
            [creneauId]
        );

        // Si le créneau n'appartient à aucun bloc, pas de restriction
        if (!bloc) {
            return { autorise: true, message: null, blocNom: null, creneauExistant: null };
        }

        // Vérifier si l'utilisateur est déjà inscrit à un créneau de ce même bloc
        const inscriptionExistante = await db.get(
            db.isPostgres
                ? `SELECT i.id, c.nom as creneau_nom, c.jour_semaine, c.heure_debut, c.heure_fin
                   FROM inscriptions i
                   JOIN creneaux c ON i.creneau_id = c.id
                   JOIN bloc_creneaux bc ON c.id = bc.creneau_id
                   WHERE i.user_id = $1
                     AND bc.bloc_id = $2
                     AND i.creneau_id != $3
                     AND i.statut = 'inscrit'
                   LIMIT 1`
                : `SELECT i.id, c.nom as creneau_nom, c.jour_semaine, c.heure_debut, c.heure_fin
                   FROM inscriptions i
                   JOIN creneaux c ON i.creneau_id = c.id
                   JOIN bloc_creneaux bc ON c.id = bc.creneau_id
                   WHERE i.user_id = ?
                     AND bc.bloc_id = ?
                     AND i.creneau_id != ?
                     AND i.statut = 'inscrit'
                   LIMIT 1`,
            [userId, bloc.id, creneauId]
        );

        if (inscriptionExistante) {
            const joursNoms = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
            return {
                autorise: false,
                message: `Vous êtes déjà inscrit au créneau « ${inscriptionExistante.creneau_nom} » (${joursNoms[inscriptionExistante.jour_semaine]} ${inscriptionExistante.heure_debut}) dans le bloc « ${bloc.nom} ». Un seul créneau par bloc est autorisé.`,
                blocNom: bloc.nom,
                creneauExistant: inscriptionExistante.creneau_nom
            };
        }

        return { autorise: true, message: null, blocNom: bloc.nom, creneauExistant: null };
    } catch (err) {
        console.error('Erreur lors de la vérification de la règle de bloc:', err);
        return { autorise: false, message: "Erreur lors de la vérification des règles d'inscription" };
    }
};

// Vérifier les méta-règles d'inscription
const verifierMetaRegles = async (db, userId, creneauId) => {
    try {
        // Vérifier si les méta-règles sont activées
        const config = await db.get(
            `SELECT enabled FROM meta_rules_config LIMIT 1`
        );

        if (!config || !config.enabled) {
            return { autorise: true, message: null };
        }

        // Récupérer les infos de l'utilisateur
        const user = await db.get(
            db.isPostgres
                ? `SELECT licence_type FROM users WHERE id = $1`
                : `SELECT licence_type FROM users WHERE id = ?`,
            [userId]
        );

        if (!user) {
            return { autorise: false, message: "Utilisateur non trouvé" };
        }

        // Récupérer les infos du créneau cible
        const creneau = await db.get(
            db.isPostgres
                ? `SELECT jour_semaine, sport_id FROM creneaux WHERE id = $1`
                : `SELECT jour_semaine, sport_id FROM creneaux WHERE id = ?`,
            [creneauId]
        );

        if (!creneau) {
            return { autorise: false, message: "Créneau non trouvé" };
        }

        // Les méta-règles sont propres à un sport : une règle natation ne doit pas
        // interdire une sortie vélo le même jour.
        const metaRegles = await db.query(
            db.isPostgres
                ? `SELECT jour_source, jours_interdits, description
                   FROM meta_rules
                   WHERE licence_type = $1 AND sport_id = $2 AND active = true`
                : `SELECT jour_source, jours_interdits, description
                   FROM meta_rules
                   WHERE licence_type = ? AND sport_id = ? AND active = 1`,
            [user.licence_type, creneau.sport_id]
        );

        if (!metaRegles || metaRegles.length === 0) {
            return { autorise: true, message: null };
        }

        // Vérifier chaque règle
        for (const regle of metaRegles) {
            // Parser les jours interdits (peut être CSV "4,6" ou JSON "[4,6]")
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

            // Si le créneau cible est dans les jours interdits
            if (joursInterdits.includes(creneau.jour_semaine)) {
                // L'inscription déclenchante doit relever du même sport que la règle
                const inscriptionSource = await db.get(
                    db.isPostgres
                        ? `SELECT i.id FROM inscriptions i
                           JOIN creneaux c ON i.creneau_id = c.id
                           WHERE i.user_id = $1
                             AND c.jour_semaine = $2
                             AND c.sport_id = $3
                             AND i.statut = 'inscrit'
                           LIMIT 1`
                        : `SELECT i.id FROM inscriptions i
                           JOIN creneaux c ON i.creneau_id = c.id
                           WHERE i.user_id = ?
                             AND c.jour_semaine = ?
                             AND c.sport_id = ?
                             AND i.statut = 'inscrit'
                           LIMIT 1`,
                    [userId, regle.jour_source, creneau.sport_id]
                );

                if (inscriptionSource) {
                    const joursNoms = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
                    return {
                        autorise: false,
                        message: `Inscription interdite : vous êtes déjà inscrit à un créneau le ${joursNoms[regle.jour_source]}. ${regle.description || ''}`
                    };
                }
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
