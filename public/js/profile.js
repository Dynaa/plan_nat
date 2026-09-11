async function loadMonProfil() {
    try {
        // Charger les informations du profil
        const response = await fetch('/api/mon-profil');
        if (response.ok) {
            const profil = await response.json();

            // Remplir le formulaire
            document.getElementById('profile-prenom').value = profil.prenom;
            document.getElementById('profile-nom').value = profil.nom;
            document.getElementById('profile-email').value = profil.email;
            document.getElementById('profile-licence').value = profil.licence_type;
        }

        // Charger les statistiques
        await loadProfileStats();
    } catch (error) {
        console.error('Erreur chargement profil:', error);
        showMessage('Erreur lors du chargement du profil', 'error');
    }
}
// Statistiques par discipline : une carte par sport pratiqué, plus un total.
// Le quota n'est affiché que pour les sports qui en ont un de configuré.
async function loadProfileStats() {
    const container = document.getElementById('profile-stats');
    if (!container) return;

    try {
        const [limitesResponse, inscriptionsResponse] = await Promise.all([
            fetch('/api/mes-limites'),
            fetch('/api/mes-inscriptions')
        ]);

        const limites = limitesResponse.ok ? await limitesResponse.json() : [];
        const inscriptions = inscriptionsResponse.ok ? await inscriptionsResponse.json() : [];

        const listeLimites = Array.isArray(limites) ? limites : (limites ? [limites] : []);
        const inscrites = inscriptions.filter(i => i.statut === 'inscrit');

        // Regrouper les inscriptions actives par sport
        const parSport = new Map();
        for (const inscription of inscrites) {
            const cle = inscription.sport_id || 'sans-sport';
            if (!parSport.has(cle)) {
                parSport.set(cle, {
                    nom: inscription.sport_nom || 'Autre',
                    icone: inscription.sport_icone || '',
                    couleur: inscription.sport_couleur || '#28A0E8',
                    total: 0
                });
            }
            parSport.get(cle).total++;
        }

        // Un sport contraint apparaît même sans inscription, pour montrer le quota
        for (const limite of listeLimites) {
            if (!parSport.has(limite.sportId)) {
                parSport.set(limite.sportId, {
                    nom: limite.sportNom || 'Sport',
                    icone: limite.sportIcone || '',
                    couleur: '#28A0E8',
                    total: 0
                });
            }
        }

        const cartes = [`
            <div class="stat-card">
                <div class="stat-value">${inscrites.length}</div>
                <div class="stat-label">Inscriptions actives</div>
            </div>
        `];

        for (const [sportId, sport] of parSport) {
            const limite = listeLimites.find(l => l.sportId === sportId);
            const valeur = limite
                ? `${limite.seancesActuelles}/${limite.maxSeances}`
                : `${sport.total}`;
            const libelle = limite ? 'cette semaine (quota)' : 'inscription(s)';

            cartes.push(`
                <div class="stat-card" style="border-left: 4px solid ${sport.couleur};">
                    <div class="stat-value" style="color: ${sport.couleur};">${valeur}</div>
                    <div class="stat-label">${sport.icone} ${sport.nom}<br><small>${libelle}</small></div>
                </div>
            `);
        }

        container.innerHTML = cartes.join('');
    } catch (error) {
        console.error('Erreur chargement stats:', error);
        container.innerHTML = '<p style="color: #718096;">Statistiques indisponibles pour le moment.</p>';
    }
}
async function handleUpdateProfile(e) {
    e.preventDefault();

    const prenom = document.getElementById('profile-prenom').value;
    const nom = document.getElementById('profile-nom').value;
    const email = document.getElementById('profile-email').value;

    try {
        const response = await fetch('/api/mon-profil', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ nom, prenom, email })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(data.message, 'success');
            // Mettre à jour le nom affiché dans la navigation
            userName.textContent = `${prenom} ${nom}`;
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        console.error('Erreur mise à jour profil:', error);
        showMessage('Erreur lors de la mise à jour du profil', 'error');
    }
}
async function handleChangePassword(e) {
    e.preventDefault();

    const motDePasseActuel = document.getElementById('current-password').value;
    const nouveauMotDePasse = document.getElementById('new-password').value;
    const confirmerMotDePasse = document.getElementById('confirm-password').value;

    if (nouveauMotDePasse !== confirmerMotDePasse) {
        showMessage('Les nouveaux mots de passe ne correspondent pas', 'error');
        return;
    }

    try {
        const response = await fetch('/api/changer-mot-de-passe', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ motDePasseActuel, nouveauMotDePasse, confirmerMotDePasse })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(data.message, 'success');
            // Réinitialiser le formulaire
            document.getElementById('password-form').reset();
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        console.error('Erreur changement mot de passe:', error);
        showMessage('Erreur lors du changement de mot de passe', 'error');
    }
}