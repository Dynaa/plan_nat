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
async function loadProfileStats() {
    try {
        // Charger les limites
        const limitesResponse = await fetch('/api/mes-limites');
        if (limitesResponse.ok) {
            const limites = await limitesResponse.json();
            document.getElementById('stat-seances').textContent = limites.seancesActuelles;
            document.getElementById('stat-limite').textContent = limites.maxSeances;
        }

        // Charger les inscriptions
        const inscriptionsResponse = await fetch('/api/mes-inscriptions');
        if (inscriptionsResponse.ok) {
            const inscriptions = await inscriptionsResponse.json();
            document.getElementById('stat-inscriptions').textContent = inscriptions.length;
        }
    } catch (error) {
        console.error('Erreur chargement stats:', error);
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