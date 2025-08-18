// État de l'application
let currentUser = null;
let creneaux = [];

// Éléments DOM
const authSection = document.getElementById('auth-section');
const mainSection = document.getElementById('main-section');
const navMenu = document.getElementById('nav-menu');
const userName = document.getElementById('user-name');

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    checkAuthStatus();
});

function setupEventListeners() {
    // Onglets d'authentification
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.dataset.tab;
            switchAuthTab(tab);
        });
    });

    // Onglets principaux
    document.querySelectorAll('.main-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.dataset.tab;
            switchMainTab(tab);
        });
    });

    // Sous-onglets d'administration
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tab = e.target.dataset.adminTab;
            switchAdminTab(tab);
        });
    });

    // Formulaires
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    document.getElementById('create-creneau-form').addEventListener('submit', handleCreateCreneau);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
}

function switchAuthTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(form => form.classList.remove('active'));
    
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(`${tab}-form`).classList.add('active');
}

function switchMainTab(tab) {
    // Vérifier les permissions pour l'onglet admin
    if (tab === 'admin' && (!currentUser || currentUser.role !== 'admin')) {
        showMessage('Accès non autorisé à l\'administration', 'error');
        // Rediriger vers l'onglet créneaux
        tab = 'creneaux';
    }
    
    document.querySelectorAll('.main-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    const tabButton = document.querySelector(`[data-tab="${tab}"]`);
    const tabContent = document.getElementById(`${tab}-tab`);
    
    if (tabButton && tabContent) {
        tabButton.classList.add('active');
        tabContent.classList.add('active');
    }
    
    // Charger les données selon l'onglet
    if (tab === 'creneaux') {
        loadCreneaux();
    } else if (tab === 'mes-inscriptions') {
        loadMesInscriptions();
    } else if (tab === 'admin') {
        loadAdminCreneaux();
        // Charger les utilisateurs si on est sur cet onglet
        const activeAdminTab = document.querySelector('.admin-tab-btn.active');
        if (activeAdminTab) {
            const adminTabName = activeAdminTab.dataset.adminTab;
            if (adminTabName === 'users') {
                loadAdminUsers();
            } else if (adminTabName === 'limites') {
                loadAdminLimites();
            }
        }
    }
}

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

function resetToDefaultTabs() {
    // Réinitialiser les onglets principaux
    document.querySelectorAll('.main-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    // Activer l'onglet créneaux par défaut
    document.querySelector('[data-tab="creneaux"]').classList.add('active');
    document.getElementById('creneaux-tab').classList.add('active');
    
    // Réinitialiser les sous-onglets d'administration
    document.querySelectorAll('.admin-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(content => content.classList.remove('active'));
    
    // Activer le sous-onglet créneaux par défaut dans l'admin
    const firstAdminTab = document.querySelector('.admin-tab-btn[data-admin-tab="creneaux"]');
    const firstAdminContent = document.getElementById('admin-creneaux-section');
    if (firstAdminTab && firstAdminContent) {
        firstAdminTab.classList.add('active');
        firstAdminContent.classList.add('active');
    }
}

function showAuthInterface() {
    authSection.style.display = 'block';
    mainSection.style.display = 'none';
    navMenu.style.display = 'none';
}

function showMainInterface() {
    authSection.style.display = 'none';
    mainSection.style.display = 'block';
    navMenu.style.display = 'flex';
    userName.textContent = `${currentUser.prenom} ${currentUser.nom}`;
    
    // Afficher la licence de l'utilisateur (temporaire pour debug)
    if (currentUser.licence_type) {
        userName.textContent += ` (${currentUser.licence_type})`;
    }
    
    // Gérer l'affichage de l'onglet admin
    const adminTab = document.querySelector('[data-tab="admin"]');
    if (currentUser.role === 'admin') {
        adminTab.style.display = 'block';
    } else {
        adminTab.style.display = 'none';
        
        // Si l'onglet admin était actif et que l'utilisateur n'est pas admin,
        // rediriger vers l'onglet créneaux
        const activeTab = document.querySelector('.main-tab-btn.active');
        if (activeTab && activeTab.dataset.tab === 'admin') {
            switchMainTab('creneaux');
            return; // switchMainTab va déjà charger les créneaux
        }
    }
    
    // Forcer l'affichage de l'onglet créneaux par défaut si aucun onglet n'est actif
    const activeTab = document.querySelector('.main-tab-btn.active');
    if (!activeTab || (activeTab.dataset.tab === 'admin' && currentUser.role !== 'admin')) {
        switchMainTab('creneaux');
    } else {
        // Charger les données de l'onglet actuel
        const currentTabName = activeTab.dataset.tab;
        switchMainTab(currentTabName);
    }
}

async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth-status');
        const data = await response.json();
        
        if (data.authenticated) {
            currentUser = data.user;
            // Réinitialiser aux onglets par défaut avant d'afficher l'interface
            resetToDefaultTabs();
            showMainInterface();
        } else {
            showAuthInterface();
        }
    } catch (error) {
        console.log('Erreur de vérification auth:', error);
        showAuthInterface();
    }
}

async function loadCreneaux() {
    try {
        const response = await fetch('/api/creneaux');
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

function displayCreneaux() {
    const container = document.getElementById('creneaux-list');
    
    if (creneaux.length === 0) {
        container.innerHTML = '<p>Aucun créneau disponible pour le moment.</p>';
        return;
    }
    
    const joursMap = {
        0: 'Dimanche', 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi',
        4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi'
    };
    
    container.innerHTML = creneaux.map(creneau => {
        const disponible = creneau.inscrits < creneau.capacite_max;
        const statusClass = disponible ? 'available' : 'full';
        const statusText = disponible ? 'Places disponibles' : 'Complet';
        
        // Vérifier si l'utilisateur peut s'inscrire (licence compatible)
        const licencesAutorisees = creneau.licences_autorisees ? creneau.licences_autorisees.split(',') : [];
        const userLicence = currentUser ? currentUser.licence_type : null;
        const peutSinscrire = !currentUser || !userLicence || licencesAutorisees.includes(userLicence);
        const licencesText = licencesAutorisees.length > 0 ? licencesAutorisees.join(', ') : 'Toutes licences';
        
        // Debug pour identifier le problème
        if (currentUser && userLicence) {
            console.log(`Créneau: ${creneau.nom}, Licences autorisées: [${licencesAutorisees.join(', ')}], Licence utilisateur: ${userLicence}, Peut s'inscrire: ${peutSinscrire}`);
        }
        
        return `
            <div class="creneau-card">
                <div class="creneau-info">
                    <h3>${creneau.nom}</h3>
                    <div class="creneau-details">
                        <div>${joursMap[creneau.jour_semaine]} • ${creneau.heure_debut} - ${creneau.heure_fin}</div>
                        <div style="color: #4299e1; font-size: 0.8rem; margin-top: 0.25rem;">
                            🎫 ${licencesText}
                        </div>
                    </div>
                </div>
                <div class="creneau-status">
                    <div class="capacite ${statusClass}">
                        ${creneau.inscrits}/${creneau.capacite_max} inscrits
                        ${creneau.en_attente > 0 ? `• ${creneau.en_attente} en attente` : ''}
                    </div>
                    <div>${statusText}</div>
                    <button onclick="inscrireCreneau(${creneau.id})" 
                            class="btn-success" 
                            ${!peutSinscrire ? 'disabled title="Votre licence ne permet pas l\'accès à ce créneau"' : ''}
                            ${!peutSinscrire ? 'style="background: #a0aec0; cursor: not-allowed;"' : ''}>
                        ${!peutSinscrire ? 'Licence incompatible' : (disponible ? 'S\'inscrire' : 'Liste d\'attente')}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function inscrireCreneau(creneauId) {
    try {
        const response = await fetch('/api/inscriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creneauId })
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
    } catch (error) {
        showMessage('Erreur de connexion', 'error');
    }
}

function displayMesLimites(limites) {
    const quotaDetails = document.getElementById('quota-details');
    const quotaVisual = document.getElementById('quota-visual');
    
    if (!limites) {
        quotaDetails.textContent = 'Informations non disponibles';
        return;
    }
    
    const pourcentage = Math.round((limites.seancesActuelles / limites.maxSeances) * 100);
    const couleur = pourcentage >= 100 ? '#e53e3e' : pourcentage >= 80 ? '#ed8936' : '#38a169';
    
    quotaDetails.innerHTML = `
        Licence <strong>${limites.licenceType}</strong> • 
        <span style="color: ${couleur}; font-weight: 500;">
            ${limites.seancesActuelles}/${limites.maxSeances} séances cette semaine
        </span>
        ${limites.seancesRestantes > 0 ? 
            `• <span style="color: #38a169;">${limites.seancesRestantes} séance(s) restante(s)</span>` : 
            `• <span style="color: #e53e3e;">Limite atteinte !</span>`
        }
    `;
    
    // Indicateur visuel
    if (limites.limiteAtteinte) {
        quotaVisual.innerHTML = '🚫';
        quotaVisual.title = 'Limite de séances atteinte';
    } else if (limites.seancesRestantes <= 1) {
        quotaVisual.innerHTML = '⚠️';
        quotaVisual.title = 'Attention : bientôt la limite';
    } else {
        quotaVisual.innerHTML = '✅';
        quotaVisual.title = 'Quota disponible';
    }
}

function displayMesInscriptions(inscriptions) {
    const container = document.getElementById('mes-inscriptions-list');
    
    if (inscriptions.length === 0) {
        container.innerHTML = '<p>Vous n\'êtes inscrit à aucun créneau.</p>';
        return;
    }
    
    const joursMap = {
        0: 'Dimanche', 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi',
        4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi'
    };
    
    container.innerHTML = inscriptions.map(inscription => {
        const statutClass = inscription.statut === 'inscrit' ? 'statut-inscrit' : 'statut-attente';
        const statutText = inscription.statut === 'inscrit' ? 'Inscrit' : 
            `Liste d'attente (${inscription.position_attente})`;
        
        return `
            <div class="inscription-item">
                <div>
                    <h4>${inscription.nom}</h4>
                    <div class="creneau-details">
                        ${joursMap[inscription.jour_semaine]} • ${inscription.heure_debut} - ${inscription.heure_fin}
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <span class="statut-badge ${statutClass}">${statutText}</span>
                    <button onclick="desinscrireCreneau(${inscription.creneau_id})" 
                            class="btn-danger">
                        Se désinscrire
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function desinscrireCreneau(creneauId) {
    if (!confirm('Êtes-vous sûr de vouloir vous désinscrire de ce créneau ?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/inscriptions/${creneauId}`, {
            method: 'DELETE'
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

async function handleCreateCreneau(e) {
    e.preventDefault();
    
    const nom = document.getElementById('creneau-nom').value;
    const jour_semaine = document.getElementById('creneau-jour').value;
    const heure_debut = document.getElementById('creneau-debut').value;
    const heure_fin = document.getElementById('creneau-fin').value;
    const capacite_max = document.getElementById('creneau-capacite').value;
    
    // Récupérer les licences sélectionnées
    const licencesCheckboxes = document.querySelectorAll('#licences-checkboxes input[type="checkbox"]:checked');
    const licences_autorisees = Array.from(licencesCheckboxes).map(cb => cb.value).join(',');
    
    try {
        const response = await fetch('/api/creneaux', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nom, jour_semaine, heure_debut, heure_fin, capacite_max, licences_autorisees })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage('Créneau créé avec succès', 'success');
            document.getElementById('create-creneau-form').reset();
            loadAdminCreneaux();
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Erreur lors de la création du créneau', 'error');
    }
}

async function loadAdminCreneaux() {
    try {
        const response = await fetch('/api/creneaux');
        const data = await response.json();
        
        if (response.ok) {
            displayAdminCreneaux(data);
        } else {
            showMessage('Erreur lors du chargement des créneaux', 'error');
        }
    } catch (error) {
        showMessage('Erreur de connexion', 'error');
    }
}

function displayAdminCreneaux(creneaux) {
    const container = document.getElementById('admin-creneaux-list');
    
    if (creneaux.length === 0) {
        container.innerHTML = '<p>Aucun créneau créé.</p>';
        return;
    }
    
    const joursMap = {
        0: 'Dimanche', 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi',
        4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi'
    };
    
    container.innerHTML = creneaux.map(creneau => {
        const licencesText = creneau.licences_autorisees ? creneau.licences_autorisees.split(',').join(', ') : 'Toutes licences';
        
        return `
            <div class="creneau-card">
                <div class="creneau-info">
                    <h4>${creneau.nom}</h4>
                    <div class="creneau-details">
                        ${joursMap[creneau.jour_semaine]} • ${creneau.heure_debut} - ${creneau.heure_fin}
                        <div style="color: #4299e1; font-size: 0.8rem; margin-top: 0.25rem;">
                            🎫 ${licencesText}
                        </div>
                    </div>
                </div>
                <div class="creneau-status">
                    <div class="capacite">
                        ${creneau.inscrits}/${creneau.capacite_max} inscrits
                        ${creneau.en_attente > 0 ? `• ${creneau.en_attente} en attente` : ''}
                    </div>
                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                        <button onclick="voirInscriptions(${creneau.id})" class="btn-warning">
                            👥 Inscriptions
                        </button>
                        <button onclick="editerCreneau(${creneau.id})" class="btn-success">
                            ✏️ Modifier
                        </button>
                        <button onclick="supprimerCreneau(${creneau.id}, '${creneau.nom.replace(/'/g, "\\'")}', ${creneau.inscrits + creneau.en_attente})" 
                                class="btn-danger" 
                                title="${creneau.inscrits + creneau.en_attente > 0 ? 'Suppression forcée (avec inscriptions)' : 'Supprimer le créneau'}">
                            ${creneau.inscrits + creneau.en_attente > 0 ? '🗑️ Supprimer (forcé)' : '🗑️ Supprimer'}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function voirInscriptions(creneauId) {
    try {
        const response = await fetch(`/api/admin/inscriptions/${creneauId}`);
        const data = await response.json();
        
        if (response.ok) {
            displayInscriptionsModal(data);
        } else {
            showMessage('Erreur lors du chargement des inscriptions', 'error');
        }
    } catch (error) {
        showMessage('Erreur de connexion', 'error');
    }
}

function displayInscriptionsModal(inscriptions) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5); display: flex; align-items: center;
        justify-content: center; z-index: 1000;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
        background: white; border-radius: 12px; padding: 2rem;
        max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;
    
    const inscritsList = inscriptions.filter(i => i.statut === 'inscrit');
    const attentsList = inscriptions.filter(i => i.statut === 'attente');
    
    content.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h3>Inscriptions au créneau</h3>
            <button onclick="this.closest('.modal').remove()" style="background: #e53e3e;">Fermer</button>
        </div>
        
        <div style="margin-bottom: 2rem;">
            <h4 style="color: #38a169; margin-bottom: 1rem;">Inscrits (${inscritsList.length})</h4>
            ${inscritsList.length === 0 ? '<p>Aucun inscrit</p>' : 
                inscritsList.map(i => `
                    <div style="padding: 0.5rem 0; border-bottom: 1px solid #e2e8f0;">
                        ${i.prenom} ${i.nom} (${i.email})
                    </div>
                `).join('')
            }
        </div>
        
        <div>
            <h4 style="color: #ed8936; margin-bottom: 1rem;">Liste d'attente (${attentsList.length})</h4>
            ${attentsList.length === 0 ? '<p>Aucune personne en attente</p>' : 
                attentsList.map(i => `
                    <div style="padding: 0.5rem 0; border-bottom: 1px solid #e2e8f0;">
                        ${i.position_attente}. ${i.prenom} ${i.nom} (${i.email})
                    </div>
                `).join('')
            }
        </div>
    `;
    
    modal.className = 'modal';
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

async function supprimerCreneau(creneauId, nomCreneau, nbInscrits) {
    let forceDelete = false;
    
    // Si il y a des inscrits, proposer la suppression forcée
    if (nbInscrits > 0) {
        const confirmation = confirm(
            `Le créneau "${nomCreneau}" a ${nbInscrits} personne(s) inscrite(s).\n\n` +
            `Voulez-vous quand même le supprimer ?\n` +
            `⚠️ ATTENTION : Cela supprimera aussi toutes les inscriptions !\n\n` +
            `Cliquez sur "OK" pour supprimer définitivement, ou "Annuler" pour abandonner.`
        );
        
        if (!confirmation) {
            return;
        }
        forceDelete = true;
    } else {
        // Demander confirmation normale
        if (!confirm(`Êtes-vous sûr de vouloir supprimer définitivement le créneau "${nomCreneau}" ?\n\nCette action est irréversible.`)) {
            return;
        }
    }
    
    try {
        console.log('Suppression du créneau:', creneauId, forceDelete ? '(forcée)' : '');
        
        const url = forceDelete ? `/api/creneaux/${creneauId}/force` : `/api/creneaux/${creneauId}`;
        const response = await fetch(url, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage(data.message, 'success');
            loadAdminCreneaux(); // Recharger la liste
            loadCreneaux(); // Mettre à jour la liste principale aussi
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        console.error('Erreur lors de la suppression:', error);
        showMessage('Erreur lors de la suppression du créneau', 'error');
    }
}

async function editerCreneau(creneauId) {
    try {
        // Récupérer les détails du créneau
        const response = await fetch(`/api/creneaux/${creneauId}`);
        const creneau = await response.json();
        
        if (!response.ok) {
            showMessage('Erreur lors du chargement du créneau', 'error');
            return;
        }
        
        // Créer le modal d'édition
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5); display: flex; align-items: center;
            justify-content: center; z-index: 1000;
        `;
        
        const content = document.createElement('div');
        content.style.cssText = `
            background: white; border-radius: 12px; padding: 2rem;
            max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
        `;
        
        content.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                <h3>Modifier le créneau</h3>
                <button onclick="this.closest('.edit-modal').remove()" style="background: #e53e3e;">Fermer</button>
            </div>
            
            <form id="edit-creneau-form">
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Nom du créneau</label>
                    <input type="text" id="edit-nom" value="${creneau.nom}" required 
                           style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
                </div>
                
                <div style="margin-bottom: 1rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Jour de la semaine</label>
                    <select id="edit-jour" required style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
                        <option value="1" ${creneau.jour_semaine == 1 ? 'selected' : ''}>Lundi</option>
                        <option value="2" ${creneau.jour_semaine == 2 ? 'selected' : ''}>Mardi</option>
                        <option value="3" ${creneau.jour_semaine == 3 ? 'selected' : ''}>Mercredi</option>
                        <option value="4" ${creneau.jour_semaine == 4 ? 'selected' : ''}>Jeudi</option>
                        <option value="5" ${creneau.jour_semaine == 5 ? 'selected' : ''}>Vendredi</option>
                        <option value="6" ${creneau.jour_semaine == 6 ? 'selected' : ''}>Samedi</option>
                        <option value="0" ${creneau.jour_semaine == 0 ? 'selected' : ''}>Dimanche</option>
                    </select>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Heure de début</label>
                        <input type="time" id="edit-debut" value="${creneau.heure_debut}" required 
                               style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Heure de fin</label>
                        <input type="time" id="edit-fin" value="${creneau.heure_fin}" required 
                               style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
                    </div>
                </div>
                
                <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Capacité maximale</label>
                    <input type="number" id="edit-capacite" value="${creneau.capacite_max}" min="1" required 
                           style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
                    <small style="color: #718096; font-size: 0.8rem;">
                        Si vous réduisez la capacité, les derniers inscrits seront automatiquement mis sur liste d'attente.
                    </small>
                </div>
                
                <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Licences autorisées :</label>
                    <div id="edit-licences-checkboxes" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.5rem;">
                        ${['Compétition', 'Loisir/Senior', 'Benjamins/Junior', 'Poussins/Pupilles'].map(licence => {
                            const isChecked = creneau.licences_autorisees && creneau.licences_autorisees.includes(licence);
                            const emoji = licence === 'Compétition' ? '🏆' : licence === 'Loisir/Senior' ? '🏊‍♂️' : licence === 'Benjamins/Junior' ? '🧒' : '👶';
                            return `<label><input type="checkbox" value="${licence}" ${isChecked ? 'checked' : ''}> ${emoji} ${licence}</label>`;
                        }).join('')}
                    </div>
                </div>
                
                <div style="display: flex; gap: 1rem; justify-content: flex-end;">
                    <button type="button" onclick="this.closest('.edit-modal').remove()" 
                            style="background: #718096; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; cursor: pointer;">
                        Annuler
                    </button>
                    <button type="submit" 
                            style="background: #38a169; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 6px; cursor: pointer;">
                        Sauvegarder
                    </button>
                </div>
            </form>
        `;
        
        modal.className = 'edit-modal';
        modal.appendChild(content);
        document.body.appendChild(modal);
        
        // Gérer la soumission du formulaire
        document.getElementById('edit-creneau-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // Récupérer les licences sélectionnées
            const editLicencesCheckboxes = document.querySelectorAll('#edit-licences-checkboxes input[type="checkbox"]:checked');
            const licences_autorisees = Array.from(editLicencesCheckboxes).map(cb => cb.value).join(',');
            
            const formData = {
                nom: document.getElementById('edit-nom').value,
                jour_semaine: document.getElementById('edit-jour').value,
                heure_debut: document.getElementById('edit-debut').value,
                heure_fin: document.getElementById('edit-fin').value,
                capacite_max: document.getElementById('edit-capacite').value,
                licences_autorisees: licences_autorisees
            };
            
            try {
                const updateResponse = await fetch(`/api/creneaux/${creneauId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
                
                const result = await updateResponse.json();
                
                if (updateResponse.ok) {
                    showMessage(result.message, 'success');
                    modal.remove();
                    loadAdminCreneaux(); // Recharger la liste
                    loadCreneaux(); // Mettre à jour la liste principale aussi
                } else {
                    showMessage(result.error, 'error');
                }
            } catch (error) {
                console.error('Erreur lors de la modification:', error);
                showMessage('Erreur lors de la modification du créneau', 'error');
            }
        });
        
        // Fermer le modal en cliquant à l'extérieur
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
    } catch (error) {
        console.error('Erreur lors du chargement du créneau:', error);
        showMessage('Erreur lors du chargement du créneau', 'error');
    }
}

function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(content => content.classList.remove('active'));
    
    document.querySelector(`[data-admin-tab="${tab}"]`).classList.add('active');
    document.getElementById(`admin-${tab}-section`).classList.add('active');
    
    // Charger les données selon l'onglet
    if (tab === 'creneaux') {
        loadAdminCreneaux();
    } else if (tab === 'users') {
        loadAdminUsers();
    } else if (tab === 'limites') {
        loadAdminLimites();
    }
}

async function loadAdminUsers() {
    try {
        const response = await fetch('/api/admin/users');
        const data = await response.json();
        
        if (response.ok) {
            displayAdminUsers(data);
        } else {
            showMessage('Erreur lors du chargement des utilisateurs', 'error');
        }
    } catch (error) {
        showMessage('Erreur de connexion', 'error');
    }
}

function displayAdminUsers(users) {
    const container = document.getElementById('admin-users-list');
    
    if (users.length === 0) {
        container.innerHTML = '<p>Aucun utilisateur trouvé.</p>';
        return;
    }
    
    container.innerHTML = users.map(user => {
        const isCurrentUser = currentUser && currentUser.id === user.id;
        const roleClass = user.role === 'admin' ? 'role-admin' : 'role-membre';
        const createdDate = new Date(user.created_at).toLocaleDateString('fr-FR');
        
        return `
            <div class="user-card">
                <div class="user-info">
                    <h4>${user.prenom} ${user.nom} ${isCurrentUser ? '(Vous)' : ''}</h4>
                    <div class="user-details">
                        <div>📧 ${user.email}</div>
                        <div>🎫 Licence: ${user.licence_type || 'Non définie'}</div>
                        <div>📅 Inscrit le ${createdDate} • ${user.nb_inscriptions} inscription(s)</div>
                    </div>
                </div>
                <div class="user-actions">
                    <span class="user-role ${roleClass}">
                        ${user.role === 'admin' ? '👑 Administrateur' : '👤 Membre'}
                    </span>
                    <select onchange="changerRoleUtilisateur(${user.id}, this.value)" 
                            ${isCurrentUser ? 'disabled title="Vous ne pouvez pas modifier votre propre rôle"' : ''}>
                        <option value="">Changer le rôle</option>
                        <option value="membre" ${user.role === 'membre' ? 'selected' : ''}>👤 Membre</option>
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>👑 Admin</option>
                    </select>
                    <button onclick="supprimerUtilisateur(${user.id}, '${user.prenom} ${user.nom}', ${user.nb_inscriptions})" 
                            class="btn-danger"
                            ${isCurrentUser ? 'disabled title="Vous ne pouvez pas supprimer votre propre compte"' : ''}
                            ${user.nb_inscriptions > 0 ? 'title="Cet utilisateur a des inscriptions actives"' : ''}>
                        🗑️ Supprimer
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function changerRoleUtilisateur(userId, nouveauRole) {
    if (!nouveauRole) return;
    
    const confirmation = confirm(
        `Êtes-vous sûr de vouloir ${nouveauRole === 'admin' ? 'donner les droits administrateur' : 'retirer les droits administrateur'} à cet utilisateur ?`
    );
    
    if (!confirmation) {
        // Recharger pour remettre la valeur précédente
        loadAdminUsers();
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/users/${userId}/role`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: nouveauRole })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage(data.message, 'success');
            loadAdminUsers(); // Recharger la liste
        } else {
            showMessage(data.error, 'error');
            loadAdminUsers(); // Recharger pour annuler le changement
        }
    } catch (error) {
        console.error('Erreur lors du changement de rôle:', error);
        showMessage('Erreur lors du changement de rôle', 'error');
        loadAdminUsers();
    }
}

async function supprimerUtilisateur(userId, nomUtilisateur, nbInscriptions) {
    if (nbInscriptions > 0) {
        showMessage(`Impossible de supprimer ${nomUtilisateur} : ${nbInscriptions} inscription(s) active(s)`, 'error');
        return;
    }
    
    const confirmation = confirm(
        `Êtes-vous sûr de vouloir supprimer définitivement l'utilisateur "${nomUtilisateur}" ?\n\n⚠️ Cette action est irréversible !`
    );
    
    if (!confirmation) return;
    
    try {
        const response = await fetch(`/api/admin/users/${userId}`, {
            method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage(data.message, 'success');
            loadAdminUsers(); // Recharger la liste
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        console.error('Erreur lors de la suppression:', error);
        showMessage('Erreur lors de la suppression de l\'utilisateur', 'error');
    }
}

async function loadAdminLimites() {
    try {
        const response = await fetch('/api/admin/licence-limits');
        const data = await response.json();
        
        if (response.ok) {
            displayAdminLimites(data);
        } else {
            showMessage('Erreur lors du chargement des limites', 'error');
        }
    } catch (error) {
        showMessage('Erreur de connexion', 'error');
    }
}

function displayAdminLimites(limites) {
    const container = document.getElementById('admin-limites-list');
    
    // Créer un objet pour faciliter la recherche
    const limitesMap = {};
    limites.forEach(limite => {
        limitesMap[limite.licence_type] = limite.max_seances_semaine;
    });
    
    // Types de licences disponibles
    const typesLicences = ['Compétition', 'Loisir/Senior', 'Benjamins/Junior', 'Poussins/Pupilles'];
    
    container.innerHTML = `
        <div style="display: grid; gap: 1rem;">
            ${typesLicences.map(licenceType => {
                const emoji = licenceType === 'Compétition' ? '🏆' : 
                             licenceType === 'Loisir/Senior' ? '🏊‍♂️' : 
                             licenceType === 'Benjamins/Junior' ? '🧒' : '👶';
                const maxSeances = limitesMap[licenceType] || 3;
                
                return `
                    <div class="limite-card" style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                        <div class="limite-info">
                            <h4 style="margin: 0 0 0.5rem 0; color: #2d3748;">${emoji} ${licenceType}</h4>
                            <div style="color: #718096; font-size: 0.9rem;">
                                Nombre maximum de séances par semaine
                            </div>
                        </div>
                        <div class="limite-controls" style="display: flex; align-items: center; gap: 1rem;">
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <label style="font-weight: 500; color: #4a5568;">Limite :</label>
                                <input type="number" 
                                       id="limite-${licenceType.replace('/', '-')}" 
                                       value="${maxSeances}" 
                                       min="1" 
                                       max="10" 
                                       style="width: 80px; padding: 0.5rem; border: 1px solid #e2e8f0; border-radius: 6px; text-align: center;">
                                <span style="color: #718096;">séances/semaine</span>
                            </div>
                            <button onclick="modifierLimite('${licenceType}', document.getElementById('limite-${licenceType.replace('/', '-')}').value)" 
                                    class="btn-success" 
                                    style="padding: 0.5rem 1rem;">
                                💾 Sauvegarder
                            </button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
        
        <div style="margin-top: 2rem; padding: 1rem; background: #e6fffa; border: 1px solid #81e6d9; border-radius: 8px;">
            <h4 style="margin: 0 0 0.5rem 0; color: #234e52;">💡 Informations</h4>
            <ul style="margin: 0; padding-left: 1.5rem; color: #2d3748; font-size: 0.9rem;">
                <li>Les limites s'appliquent par semaine (du lundi au dimanche)</li>
                <li>Les utilisateurs ne pourront pas s'inscrire au-delà de leur limite</li>
                <li>Les changements prennent effet immédiatement</li>
                <li>Valeurs recommandées : Compétition (6), Loisir/Senior (3), Benjamins/Junior (4), Poussins/Pupilles (2)</li>
            </ul>
        </div>
    `;
}

async function modifierLimite(licenceType, nouvelleValeur) {
    const valeur = parseInt(nouvelleValeur);
    
    if (!valeur || valeur < 1 || valeur > 10) {
        showMessage('La limite doit être entre 1 et 10 séances', 'error');
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/licence-limits/${encodeURIComponent(licenceType)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ max_seances_semaine: valeur })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage(`Limite mise à jour : ${licenceType} = ${valeur} séances/semaine`, 'success');
            // Pas besoin de recharger, la valeur est déjà à jour dans l'interface
        } else {
            showMessage(data.error, 'error');
            // Recharger pour remettre l'ancienne valeur
            loadAdminLimites();
        }
    } catch (error) {
        console.error('Erreur lors de la modification:', error);
        showMessage('Erreur lors de la modification de la limite', 'error');
        loadAdminLimites();
    }
}

function showMessage(text, type) {
    const message = document.getElementById('message');
    message.textContent = text;
    message.className = `message ${type}`;
    message.classList.add('show');
    
    setTimeout(() => {
        message.classList.remove('show');
    }, 4000);
}