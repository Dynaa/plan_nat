async function handleLogin(e) {
    e.preventDefault();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    console.log('Tentative de connexion avec:', email);

    if (!email || !password) {
        showMessage('Veuillez remplir tous les champs', 'error');
        return;
    }

    try {
        console.log('Envoi de la requête de connexion...');
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        console.log('Réponse reçue:', response.status);
        const data = await response.json();
        console.log('Données reçues:', data);

        if (response.ok) {
            currentUser = data.user;
            console.log('Utilisateur connecté:', currentUser);
            showMainInterface();
            showMessage('Connexion réussie', 'success');
        } else {
            console.log('Erreur de connexion:', data.error);
            showMessage(data.error, 'error');
        }
    } catch (error) {
        console.error('Erreur lors de la connexion:', error);
        showMessage('Erreur de connexion: ' + error.message, 'error');
    }
}
async function handleRegister(e) {
    e.preventDefault();

    const prenom = document.getElementById('register-prenom').value;
    const nom = document.getElementById('register-nom').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const licence_type = document.getElementById('register-licence').value;

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prenom, nom, email, password, licence_type })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Compte créé avec succès. Vous pouvez maintenant vous connecter.', 'success');
            switchAuthTab('login');
            document.getElementById('register-form').reset();
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Erreur lors de la création du compte', 'error');
    }
}
async function handleLogout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
        currentUser = null;

        // Réinitialiser l'interface aux onglets par défaut
        resetToDefaultTabs();

        showAuthInterface();
        showMessage('Déconnexion réussie', 'success');
    } catch (error) {
        showMessage('Erreur lors de la déconnexion', 'error');
    }
}
async function checkAuthStatus() {
    try {
        console.log('🔍 Vérification du statut d\'authentification...');
        const response = await fetch('/api/auth-status');
        const data = await response.json();
        
        console.log('📊 Réponse auth-status:', data);

        if (data.authenticated) {
            console.log('✅ Utilisateur authentifié:', data.user);
            currentUser = data.user;
            // Réinitialiser aux onglets par défaut avant d'afficher l'interface
            resetToDefaultTabs();
            showMainInterface();
        } else {
            console.log('❌ Utilisateur non authentifié');
            showAuthInterface();
        }
    } catch (error) {
        console.log('💥 Erreur de vérification auth:', error);
        showAuthInterface();
    }
}