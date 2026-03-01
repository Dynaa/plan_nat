// services/businessRules.js

// Fonction pour vérifier les limites de séances par semaine
const verifierLimitesSeances = async (db, userId) => {
    // Calculer le début et la fin de la semaine courante (lundi à dimanche)
    const maintenant = new Date();
    const jourSemaine = maintenant.getDay(); // 0 = dimanche, 1 = lundi, etc.
    const joursDepuisLundi = jourSemaine === 0 ? 6 : jourSemaine - 1; // Ajuster pour que lundi = 0

    const debutSemaine = new Date(maintenant);
    debutSemaine.setDate(maintenant.getDate() - joursDepuisLundi);
    debutSemaine.setHours(0, 0, 0, 0);

    const finSemaine = new Date(debutSemaine);
    finSemaine.setDate(debutSemaine.getDate() + 6);
    finSemaine.setHours(23, 59, 59, 999);

    const query = db.isPostgres ? `
        SELECT 
            u.licence_type,
            ll.max_seances_semaine,
            COUNT(i.id) as seances_cette_semaine
        FROM users u
        LEFT JOIN licence_limits ll ON u.licence_type = ll.licence_type
        LEFT JOIN inscriptions i ON u.id = i.user_id 
            AND i.statut = 'inscrit'
            AND i.created_at >= $1 
            AND i.created_at <= $2
        WHERE u.id = $3
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
            AND i.created_at >= ? 
            AND i.created_at <= ?
        WHERE u.id = ?
        GROUP BY u.id, u.licence_type, ll.max_seances_semaine
    `;

    try {
        const result = await db.get(query, [debutSemaine.toISOString(), finSemaine.toISOString(), userId]);

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

// Fonction pour vérifier les méta-règles d'inscription
const verifierMetaRegles = async (db, userId, creneauId) => {
    try {
        // Vérifier si les méta-règles sont activées
        const config = await db.get(`SELECT enabled FROM meta_rules_config ORDER BY id DESC LIMIT 1`);

        if (!config || !config.enabled) {
            return { autorise: true, message: null };
        }

        // Récupérer les informations de l'utilisateur et du créneau
        const userInfo = await db.get(`SELECT licence_type FROM users WHERE id = $1`, [userId]);
        const creneauInfo = await db.get(`SELECT jour_semaine FROM creneaux WHERE id = $1`, [creneauId]);

        if (!userInfo || !creneauInfo) {
            return { autorise: false, message: 'Informations utilisateur ou créneau introuvables' };
        }

        // Récupérer les méta-règles actives pour ce type de licence
        const metaRegles = await db.query(`
            SELECT jour_source, jours_interdits, description 
            FROM meta_rules 
            WHERE licence_type = $1 AND active = true
        `, [userInfo.licence_type]);

        if (!metaRegles || metaRegles.length === 0) {
            return { autorise: true, message: null };
        }

        // Calculer le début et la fin de la semaine courante
        const maintenant = new Date();
        const jourSemaine = maintenant.getDay();
        const joursDepuisLundi = jourSemaine === 0 ? 6 : jourSemaine - 1;

        const debutSemaine = new Date(maintenant);
        debutSemaine.setDate(maintenant.getDate() - joursDepuisLundi);
        debutSemaine.setHours(0, 0, 0, 0);

        const finSemaine = new Date(debutSemaine);
        finSemaine.setDate(debutSemaine.getDate() + 6);
        finSemaine.setHours(23, 59, 59, 999);

        // Vérifier chaque méta-règle
        for (const regle of metaRegles) {
            // Vérifier si l'utilisateur est inscrit au jour source cette semaine
            const inscriptionSource = await db.get(`
                SELECT i.id 
                FROM inscriptions i
                JOIN creneaux c ON i.creneau_id = c.id
                WHERE i.user_id = $1 
                AND c.jour_semaine = $2 
                AND i.statut = 'inscrit'
                AND i.created_at >= $3 
                AND i.created_at <= $4
            `, [userId, regle.jour_source, debutSemaine.toISOString(), finSemaine.toISOString()]);

            if (inscriptionSource) {
                // L'utilisateur est inscrit au jour source, vérifier les jours interdits
                let joursInterdits;
                try {
                    // Essayer de parser comme JSON d'abord
                    joursInterdits = JSON.parse(regle.jours_interdits);
                } catch (e) {
                    // Si ça échoue, traiter comme une chaîne séparée par des virgules
                    joursInterdits = regle.jours_interdits.split(',').map(j => parseInt(j.trim()));
                }

                const jourCreneau = creneauInfo.jour_semaine;

                if (joursInterdits.includes(jourCreneau)) {
                    const joursNoms = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
                    return {
                        autorise: false,
                        message: `Inscription interdite : vous êtes déjà inscrit le ${joursNoms[regle.jour_source]} cette semaine. ${regle.description || ''}`
                    };
                }
            }
        }

        return { autorise: true, message: null };
    } catch (err) {
        console.error('Erreur lors de la vérification des méta-règles:', err);
        return { autorise: false, message: "Erreur lors de la vérification des règles d'inscription" };
    }
};

module.exports = { verifierLimitesSeances, verifierMetaRegles };
