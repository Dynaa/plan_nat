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
    } else if (tab === 'mon-profil') {
        loadMonProfil();
    } else if (tab === 'admin') {
        loadMetaRulesStatus(); // Charger le statut des méta-règles
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

    // Configurer les event listeners pour l'interface principale
    setupMainEventListeners();

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
function displayMesMetaRegles(metaReglesData) {
    const metaReglesContainer = document.getElementById('meta-regles-info');

    if (!metaReglesContainer) {
        // Créer le conteneur s'il n'existe pas
        const quotaSection = document.querySelector('.quota-section');
        if (quotaSection) {
            const metaReglesDiv = document.createElement('div');
            metaReglesDiv.id = 'meta-regles-info';
            metaReglesDiv.className = 'meta-regles-section';
            quotaSection.appendChild(metaReglesDiv);
        } else {
            return; // Pas de section quota, on ne peut pas afficher
        }
    }

    const container = document.getElementById('meta-regles-info');

    if (!metaReglesData.enabled || metaReglesData.rules.length === 0) {
        container.innerHTML = '';
        return;
    }

    let html = `
        <div class="meta-regles-header">
            <h4>📋 Règles d'inscription pour votre licence (${metaReglesData.licenceType})</h4>
        </div>
        <div class="meta-regles-list">
    `;

    metaReglesData.rules.forEach(regle => {
        html += `
            <div class="meta-regle-item">
                <div class="regle-condition">
                    <strong>Si inscrit le ${regle.jourSourceNom}</strong>
                </div>
                <div class="regle-interdiction">
                    → Inscription interdite : ${regle.joursInterditsNoms.join(', ')}
                </div>
                ${regle.description ? `<div class="regle-description">${regle.description}</div>` : ''}
            </div>
        `;
    });

    html += `
        </div>
    `;

    container.innerHTML = html;
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
        const capaciteMax = creneau.capacite_max || (creneau.nombre_lignes * creneau.personnes_par_ligne);
        const disponible = creneau.inscrits < capaciteMax;
        const statusClass = disponible ? 'available' : 'full';
        const statusText = disponible ? 'Places disponibles' : 'Complet';

        // Vérifier si l'utilisateur peut s'inscrire (licence compatible)
        const licencesAutorisees = creneau.licences_autorisees ? creneau.licences_autorisees.split(',') : [];
        const userLicence = currentUser ? currentUser.licence_type : null;
        const peutSinscrire = !currentUser || !userLicence || licencesAutorisees.includes(userLicence);
        const licencesText = licencesAutorisees.length > 0 ? licencesAutorisees.join(', ') : 'Toutes licences';

        // Vérifier si l'utilisateur est déjà dans ce bloc (autre créneau)
        const blocqueParBloc = creneau.inscrit_dans_bloc && creneau.inscrit_dans_bloc !== creneau.nom;
        const messageBloc = blocqueParBloc
            ? `Vous avez déjà « ${creneau.inscrit_dans_bloc} » dans ce bloc`
            : null;

        const blocBadge = creneau.bloc_nom
            ? `<div style="display:inline-block;background:#ebf8ff;color:#2b6cb0;border:1px solid #bee3f8;border-radius:999px;padding:2px 10px;font-size:0.75rem;margin-top:0.25rem;">🗂 ${creneau.bloc_nom}</div>`
            : '';

        const lignesTooltip = creneau.nombre_lignes
            ? `${creneau.nombre_lignes} ligne(s) × ${creneau.personnes_par_ligne} pers.`
            : '';

        // Formater la date
        const dateObj = new Date(creneau.date_seance);
        const dateStr = dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
        const estPasse = creneau.est_passe;

        const btnDisabled = !peutSinscrire || blocqueParBloc || estPasse;
        const btnLabel = estPasse ? 'Terminé'
            : !peutSinscrire ? 'Licence incompatible'
                : blocqueParBloc ? 'Bloc déjà utilisé'
                    : disponible ? 'S\'inscrire' : 'Liste d\'attente';

        return `
            <div class="creneau-card ${estPasse ? 'passe' : ''}">
                <div class="creneau-info">
                    <h3>${creneau.nom}</h3>
                    <div class="creneau-details">
                        <div>${joursMap[creneau.jour_semaine]} ${dateStr} • ${creneau.heure_debut} - ${creneau.heure_fin}</div>
                        <div style="color: #4299e1; font-size: 0.8rem; margin-top: 0.25rem;">
                            🎫 ${licencesText}
                        </div>
                        ${blocBadge}
                        ${messageBloc ? `<div style="color:#c05621;font-size:0.8rem;margin-top:0.25rem;">⚠️ ${messageBloc}</div>` : ''}
                    </div>
                </div>
                <div class="creneau-status">
                    <div class="capacite ${statusClass}">
                        ${creneau.inscrits}/${capaciteMax} inscrits
                        ${lignesTooltip ? `<span style="color:#718096;font-size:0.75rem;"> (${lignesTooltip})</span>` : ''}
                        ${creneau.en_attente > 0 ? `• ${creneau.en_attente} en attente` : ''}
                    </div>
                    <div>${statusText}</div>
                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                        <button onclick="voirInscritsPublic(${creneau.id}, '${creneau.nom.replace(/'/g, "\\'")}', '${creneau.date_seance}')" class="btn-warning" ${creneau.inscrits === 0 && creneau.en_attente === 0 ? 'style="display:none;"' : ''}>
                            👥 Voir inscrits
                        </button>
                        <button onclick="inscrireCreneau(${creneau.id}, '${creneau.date_seance}')" 
                                class="btn-success" 
                                ${btnDisabled ? 'disabled' : ''}
                                ${btnDisabled ? 'style="background: #a0aec0; cursor: not-allowed;"' : ''}>
                            ${btnLabel}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
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

        // Formater la date
        const dateObj = new Date(inscription.date_seance);
        const dateStr = dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

        return `
            <div class="inscription-item">
                <div>
                    <h4>${inscription.nom}</h4>
                    <div class="creneau-details">
                        ${joursMap[inscription.jour_semaine]} ${dateStr} • ${inscription.heure_debut} - ${inscription.heure_fin}
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <span class="statut-badge ${statutClass}">${statutText}</span>
                    <button onclick="desinscrireCreneau(${inscription.creneau_id}, '${inscription.date_seance}')" 
                            class="btn-danger">
                        Se désinscrire
                    </button>
                </div>
            </div>
        `;
    }).join('');
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
function displayInscriptionsModal(inscriptions, creneauId) {
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
            <button onclick="this.closest('.modal').remove()" style="background: #e53e3e; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">Fermer</button>
        </div>
        
        <div style="margin-bottom: 2rem;">
            <h4 style="color: #38a169; margin-bottom: 1rem;">✅ Inscrits (${inscritsList.length})</h4>
            ${inscritsList.length === 0 ? '<p style="color: #718096;">Aucun inscrit</p>' :
            inscritsList.map(i => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 0.5rem; background: #f7fafc;">
                        <div>
                            <strong>${i.prenom} ${i.nom}</strong><br>
                            <small style="color: #718096;">${i.email}</small>
                        </div>
                        <button onclick="desinscrireUtilisateur(${i.user_id}, ${creneauId}, '${i.prenom} ${i.nom}')" 
                                style="background: #e53e3e; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">
                            🗑️ Désinscrire
                        </button>
                    </div>
                `).join('')}
        </div>
        
        ${attentsList.length > 0 ? `
        <div style="margin-bottom: 2rem;">
            <h4 style="color: #ed8936; margin-bottom: 1rem;">⏳ Liste d'attente (${attentsList.length})</h4>
            ${attentsList.map(i => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border: 1px solid #fed7aa; border-radius: 6px; margin-bottom: 0.5rem; background: #fffbeb;">
                    <div>
                        <strong>${i.prenom} ${i.nom}</strong> <span style="color: #ed8936;">(Position ${i.position_attente})</span><br>
                        <small style="color: #718096;">${i.email}</small>
                    </div>
                    <div style="display: flex; gap: 0.25rem;">
                        <button onclick="promouvoirUtilisateur(${i.user_id}, ${creneauId}, '${i.prenom} ${i.nom}')" 
                                style="background: #38a169; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">
                            ⬆️ Promouvoir
                        </button>
                        <button onclick="desinscrireUtilisateur(${i.user_id}, ${creneauId}, '${i.prenom} ${i.nom}')" 
                                style="background: #e53e3e; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.8rem;">
                            🗑️ Retirer
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
        ` : ''}
        
        <div style="border-top: 1px solid #e2e8f0; padding-top: 1rem;">
            <h4 style="margin-bottom: 1rem;">➕ Inscrire un utilisateur</h4>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
                <input type="email" id="email-inscription" placeholder="Email de l'utilisateur" 
                       style="flex: 1; padding: 0.5rem; border: 1px solid #e2e8f0; border-radius: 4px;">
                <button onclick="inscrireUtilisateur(${creneauId})" 
                        style="background: #4299e1; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">
                    Inscrire
                </button>
            </div>
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

async function voirInscritsPublic(creneauId, nomCreneau, date_seance) {
    try {
        const response = await fetch(`/api/creneaux/${creneauId}/inscrits?date_seance=${date_seance}`);
        const data = await response.json();

        if (response.ok) {
            displayInscritsPublicModal(data, nomCreneau, date_seance);
        } else {
            showMessage(data.error || 'Erreur lors du chargement des inscrits', 'error');
        }
    } catch (error) {
        console.error('Erreur voir inscrits:', error);
        showMessage('Erreur de connexion', 'error');
    }
}
function displayInscritsPublicModal(inscrits, nomCreneau, date_seance) {
    const existingModal = document.querySelector('.modal');
    if (existingModal) existingModal.remove();

    const dateObj = new Date(date_seance);
    const dateStr = dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

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

    const inscritsList = inscrits.filter(i => i.statut === 'inscrit');
    const attenteList = inscrits.filter(i => i.statut === 'attente');

    content.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h3>Inscrits à ${nomCreneau} (${dateStr})</h3>
            <button onclick="this.closest('.modal').remove()" style="background: #e53e3e; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">Fermer</button>
        </div>
        
        <div style="margin-bottom: 2rem;">
            <h4 style="color: #38a169; margin-bottom: 1rem;">✅ Inscrits (${inscritsList.length})</h4>
            ${inscritsList.length === 0 ? '<p style="color: #718096;">Aucun inscrit</p>' :
            inscritsList.map(i => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 0.5rem; background: #f7fafc;">
                        <div>
                            <strong>${i.prenom} ${i.nom}</strong>
                        </div>
                    </div>
                `).join('')}
        </div>
        
        ${attenteList.length > 0 ? `
        <div style="margin-bottom: 2rem;">
            <h4 style="color: #ed8936; margin-bottom: 1rem;">⏳ Liste d'attente (${attenteList.length})</h4>
            ${attenteList.map(i => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; border: 1px solid #fed7aa; border-radius: 6px; margin-bottom: 0.5rem; background: #fffbeb;">
                    <div>
                        <strong>${i.prenom} ${i.nom}</strong> <span style="color: #ed8936;">(Position ${i.position_attente})</span>
                    </div>
                </div>
            `).join('')}
        </div>
        ` : ''}
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
    } else if (tab === 'blocs') {
        loadBlocs();
    } else if (tab === 'meta-rules') {
        loadMetaRulesConfig();
        loadMetaRules();
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
                    <div class="user-controls">
                        <select onchange="changerRoleUtilisateur(${user.id}, this.value)" 
                                ${isCurrentUser ? 'disabled title="Vous ne pouvez pas modifier votre propre rôle"' : ''}>
                            <option value="">Changer le rôle</option>
                            <option value="membre" ${user.role === 'membre' ? 'selected' : ''}>👤 Membre</option>
                            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>👑 Admin</option>
                        </select>
                        <select onchange="changerLicenceUtilisateur(${user.id}, this.value)">
                            <option value="">Changer la licence</option>
                            <option value="Compétition" ${user.licence_type === 'Compétition' ? 'selected' : ''}>🏆 Compétition</option>
                            <option value="Loisir/Senior" ${user.licence_type === 'Loisir/Senior' ? 'selected' : ''}>🏊‍♂️ Loisir/Senior</option>
                            <option value="Benjamins/Junior" ${user.licence_type === 'Benjamins/Junior' ? 'selected' : ''}>🧒 Benjamins/Junior</option>
                            <option value="Poussins/Pupilles" ${user.licence_type === 'Poussins/Pupilles' ? 'selected' : ''}>👶 Poussins/Pupilles</option>
                        </select>
                        <button onclick="reinitialiserMotDePasse(${user.id}, '${user.prenom} ${user.nom}')" 
                                class="btn-warning" title="Réinitialiser le mot de passe">
                            🔑 Reset MDP
                        </button>
                        <button onclick="supprimerUtilisateur(${user.id}, '${user.prenom} ${user.nom}', ${user.nb_inscriptions})" 
                                class="btn-danger"
                                ${isCurrentUser ? 'disabled title="Vous ne pouvez pas supprimer votre propre compte"' : ''}
                                ${user.nb_inscriptions > 0 ? 'title="Cet utilisateur a des inscriptions actives"' : ''}>
                            🗑️ Supprimer
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
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
let messageTimeout;

function showMessage(text, type) {
    const message = document.getElementById('message');

    // Annuler le timeout précédent s'il existe
    if (messageTimeout) {
        clearTimeout(messageTimeout);
    }

    message.textContent = text;
    message.className = `message ${type}`;

    // Forcer le reflow pour relancer l'animation si le message était déjà visible
    void message.offsetWidth;

    message.classList.add('show');

    messageTimeout = setTimeout(() => {
        message.classList.remove('show');
    }, 4000);
}
function displayMetaRules(rules) {
    const container = document.getElementById('meta-rules-list');

    if (rules.length === 0) {
        container.innerHTML = '<p style="color: #718096;">Aucune méta-règle définie.</p>';
        return;
    }

    const joursNoms = {
        0: 'Dimanche', 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi',
        4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi'
    };

    container.innerHTML = rules.map(rule => {
        const joursInterdits = rule.jours_interdits.split(',').map(j => joursNoms[parseInt(j.trim())]).join(', ');
        const statusClass = rule.active ? 'statut-inscrit' : 'statut-attente';
        const statusText = rule.active ? 'Active' : 'Inactive';

        return `
            <div class="creneau-card" style="margin-bottom: 1rem;">
                <div class="creneau-info">
                    <h4>${rule.licence_type}</h4>
                    <div class="creneau-details">
                        <strong>Si inscrit le ${joursNoms[rule.jour_source]}</strong> → Interdire: ${joursInterdits}
                        ${rule.description ? `<br><em style="color: #718096;">${rule.description}</em>` : ''}
                        <br><small style="color: #718096;">
                            Créée par ${rule.nom} ${rule.prenom} le ${new Date(rule.created_at).toLocaleDateString()}
                        </small>
                    </div>
                </div>
                <div class="creneau-status">
                    <span class="statut-badge ${statusClass}">${statusText}</span>
                    <div style="display: flex; gap: 0.5rem;">
                        <button onclick="editMetaRule(${rule.id})" 
                                class="btn-success" 
                                style="font-size: 0.8rem;">
                            ✏️ Modifier
                        </button>
                        <button onclick="toggleMetaRule(${rule.id})" 
                                class="${rule.active ? 'btn-warning' : 'btn-success'}" 
                                style="font-size: 0.8rem;">
                            ${rule.active ? '⏸️ Désactiver' : '▶️ Activer'}
                        </button>
                        <button onclick="deleteMetaRule(${rule.id}, '${rule.licence_type}', '${joursNoms[rule.jour_source]}')" 
                                class="btn-danger" 
                                style="font-size: 0.8rem;">
                            🗑️ Supprimer
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}


// Afficher les blocs
function displayBlocs(blocs) {
    const container = document.getElementById('blocs-list');
    if (!container) return;

    if (!blocs || blocs.length === 0) {
        container.innerHTML = '<p style="color: #718096;">Aucun bloc créé</p>';
        return;
    }

    container.innerHTML = blocs.map(bloc => `
        <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div style="flex: 1;">
                    <h4 style="margin: 0 0 0.5rem 0; color: #2d3748;">${bloc.nom}</h4>
                    <p style="margin: 0 0 0.5rem 0; color: #718096; font-size: 0.9rem;">${bloc.description || 'Pas de description'}</p>
                    <p style="margin: 0; color: #4a5568; font-size: 0.85rem;">
                        📊 <strong>${bloc.nb_creneaux || 0}</strong> créneau(x) dans ce bloc
                    </p>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button onclick="manageCreneauxBloc(${bloc.id}, '${bloc.nom.replace(/'/g, "\\'")}')" 
                            class="btn-success" style="padding: 0.5rem 1rem; font-size: 0.85rem;">
                        📋 Gérer les créneaux
                    </button>
                    <button onclick="editBloc(${bloc.id})" 
                            class="btn-warning" style="padding: 0.5rem 1rem; font-size: 0.85rem;">
                        ✏️ Modifier
                    </button>
                    <button onclick="deleteBloc(${bloc.id}, '${bloc.nom.replace(/'/g, "\\'")}')" 
                            class="btn-danger" style="padding: 0.5rem 1rem; font-size: 0.85rem;">
                        🗑️ Supprimer
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}
