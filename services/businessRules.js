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
