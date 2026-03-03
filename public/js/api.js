// Ajout d'une variable globale pour tracker la semaine sélectionnée
let currentSemaineOffset = 0; // 0 = cette semaine, 1 = semaine pro

async function loadCreneaux() {
    try {
        const response = await fetch(`/api/creneaux?semaine=${currentSemaineOffset}`);
        const data = await response.json();

        if (response.ok) {
            creneaux = data;
            displayCreneaux();
        } else {
            showMessage('Erreur lors du chargement des créneaux', 'error');
        }
    } catch (error) {
        showMessage('Erreur de connexion', 'error');
    }
}
async function inscrireCreneau(creneauId, date_seance) {
    try {
        const response = await fetch('/api/inscriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creneauId, date_seance })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(data.message, 'success');
            loadCreneaux(); // Recharger pour mettre à jour les compteurs
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Erreur lors de l\'inscription', 'error');
    }
}
async function loadMesInscriptions() {
    try {
        // Charger les inscriptions
        const response = await fetch('/api/mes-inscriptions');
        const data = await response.json();

        if (response.ok) {
            displayMesInscriptions(data);
        } else {
            showMessage('Erreur lors du chargement des inscriptions', 'error');
        }

        // Charger les limites de l'utilisateur
        const limitesResponse = await fetch('/api/mes-limites');
        const limitesData = await limitesResponse.json();

        if (limitesResponse.ok) {
            displayMesLimites(limitesData);
        }

        // Charger les méta-règles de l'utilisateur
        const metaReglesResponse = await fetch('/api/mes-meta-regles');
        const metaReglesData = await metaReglesResponse.json();

        if (metaReglesResponse.ok) {
            displayMesMetaRegles(metaReglesData);
        }
    } catch (error) {
        showMessage('Erreur de connexion', 'error');
    }
}
async function desinscrireCreneau(creneauId, date_seance) {
    if (!confirm('Êtes-vous sûr de vouloir vous désinscrire de ce créneau ?')) {
        return;
    }

    try {
        const response = await fetch(`/api/inscriptions/${creneauId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date_seance })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(data.message, 'success');
            loadMesInscriptions(); // Recharger la liste
            loadCreneaux(); // Mettre à jour les compteurs
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Erreur lors de la désinscription', 'error');
    }
}
