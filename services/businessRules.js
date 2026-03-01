// services/businessRules.js

// Fonction pour vérifier les limites de séances par semaine
const verifierLimitesSeances = async (db, userId) => {
    const query = db.isPostgres ? `
        SELECT 
            u.licence_type,
            ll.max_seances_semaine,
            COUNT(i.id) as seances_cette_semaine
        FROM users u
        LEFT JOIN licence_limits ll ON u.licence_type = ll.licence_type
        LEFT JOIN inscriptions i ON u.id = i.user_id 
            AND i.statut = 'inscrit'
        WHERE u.id = $1
        GROUP BY u.id, u.licence_type, ll.max_seances_semaine
    ` : `
        SELECT 
            u.licence_type,
            ll.max_seances_semaine,
            COUNT(i.id) as seances_cette_semaine
        FROM users u
        LEFT JOIN licence_limits ll ON u.licence_type = ll.licence_type
        LEFT JOIN inscriptions i ON u.id = i.user_id 
            AND i.statut = 'inscrit'
        WHERE u.id = ?
        GROUP BY u.id, u.licence_type, ll.max_seances_semaine
    `;

    try {
        const result = await db.get(query, [userId]);

        if (!result) {
            throw new Error('Utilisateur non trouvé');
        }

        const limiteAtteinte = result.seances_cette_semaine >= (result.max_seances_semaine || 3);

        return {
            licenceType: result.licence_type,
            maxSeances: result.max_seances_semaine || 3,
            seancesActuelles: parseInt(result.seances_cette_semaine) || 0,
            limiteAtteinte: limiteAtteinte,
            seancesRestantes: Math.max(0, (result.max_seances_semaine || 3) - (parseInt(result.seances_cette_semaine) || 0))
        };
    } catch (err) {
        console.error('Erreur lors de la vérification des limites:', err);
        throw err;
    }
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

module.exports = { verifierLimitesSeances, verifierRegleBloc };


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
                ? `SELECT jour_semaine FROM creneaux WHERE id = $1`
                : `SELECT jour_semaine FROM creneaux WHERE id = ?`,
            [creneauId]
        );

        if (!creneau) {
            return { autorise: false, message: "Créneau non trouvé" };
        }

        // Récupérer les méta-règles pour ce type de licence
        const metaRegles = await db.query(
            db.isPostgres
                ? `SELECT jour_source, jours_interdits, description 
                   FROM meta_rules 
                   WHERE licence_type = $1 AND active = true`
                : `SELECT jour_source, jours_interdits, description 
                   FROM meta_rules 
                   WHERE licence_type = ? AND active = 1`,
            [user.licence_type]
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
                // Vérifier si l'utilisateur est inscrit au jour source
                const inscriptionSource = await db.get(
                    db.isPostgres
                        ? `SELECT i.id FROM inscriptions i
                           JOIN creneaux c ON i.creneau_id = c.id
                           WHERE i.user_id = $1 
                             AND c.jour_semaine = $2 
                             AND i.statut = 'inscrit'
                           LIMIT 1`
                        : `SELECT i.id FROM inscriptions i
                           JOIN creneaux c ON i.creneau_id = c.id
                           WHERE i.user_id = ? 
                             AND c.jour_semaine = ? 
                             AND i.statut = 'inscrit'
                           LIMIT 1`,
                    [userId, regle.jour_source]
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

module.exports = { verifierLimitesSeances, verifierRegleBloc, verifierMetaRegles };
