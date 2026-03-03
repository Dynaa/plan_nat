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

    // Toggle de semaine
    const btnCetteSemaine = document.getElementById('btn-cette-semaine');
    const btnSemainePro = document.getElementById('btn-semaine-pro');

    if (btnCetteSemaine && btnSemainePro) {
        btnCetteSemaine.addEventListener('click', () => {
            if (currentSemaineOffset !== 0) {
                currentSemaineOffset = 0;
                btnCetteSemaine.classList.add('active');
                btnCetteSemaine.style.background = '#ebf8ff';
                btnCetteSemaine.style.color = '#2b6cb0';
                btnCetteSemaine.style.fontWeight = 'bold';

                btnSemainePro.classList.remove('active');
                btnSemainePro.style.background = 'white';
                btnSemainePro.style.color = '#4a5568';
                btnSemainePro.style.fontWeight = 'normal';

                loadCreneaux();
            }
        });

        btnSemainePro.addEventListener('click', () => {
            if (currentSemaineOffset !== 1) {
                currentSemaineOffset = 1;
                btnSemainePro.classList.add('active');
                btnSemainePro.style.background = '#ebf8ff';
                btnSemainePro.style.color = '#2b6cb0';
                btnSemainePro.style.fontWeight = 'bold';

                btnCetteSemaine.classList.remove('active');
                btnCetteSemaine.style.background = 'white';
                btnCetteSemaine.style.color = '#4a5568';
                btnCetteSemaine.style.fontWeight = 'normal';

                loadCreneaux();
            }
        });
    }

    // Formulaires
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('register-form').addEventListener('submit', handleRegister);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Event listeners pour les formulaires qui n'existent que quand connecté
    // Ils seront ajoutés dans setupMainEventListeners()
}

function setupMainEventListeners() {
    // Event listeners pour l'interface principale (après connexion)
    const createCreneauForm = document.getElementById('create-creneau-form');
    const profileForm = document.getElementById('profile-form');
    const passwordForm = document.getElementById('password-form');
    const createBlocForm = document.getElementById('create-bloc-form');

    if (createCreneauForm) {
        createCreneauForm.addEventListener('submit', handleCreateCreneau);
    }
    if (profileForm) {
        profileForm.addEventListener('submit', handleUpdateProfile);
    }
    if (passwordForm) {
        passwordForm.addEventListener('submit', handleChangePassword);
    }
    if (createBlocForm) {
        createBlocForm.addEventListener('submit', handleCreateBloc);
    }

    // Event listener pour les méta-règles
    const metaRuleForm = document.getElementById('create-meta-rule-form');
    if (metaRuleForm) {
        metaRuleForm.addEventListener('submit', handleCreateMetaRule);
    }
}























// Fonctions de gestion des inscriptions par les admins















// Fonction de remise à zéro hebdomadaire


// Fonctions pour l'onglet Mon Profil



// ===== FONCTIONS MÉTA-RÈGLES =====







async function editMetaRule(ruleId) {
    try {
        // Récupérer les données de la règle
        const response = await fetch('/api/admin/meta-rules');
        const rules = await response.json();

        if (!response.ok) {
            showMessage('Erreur lors du chargement des règles', 'error');
            return;
        }

        const rule = rules.find(r => r.id === ruleId);
        if (!rule) {
            showMessage('Règle non trouvée', 'error');
            return;
        }

        // Créer le modal d'édition
        showEditMetaRuleModal(rule);
    } catch (error) {
        showMessage('Erreur lors du chargement de la règle', 'error');
    }
}

function showEditMetaRuleModal(rule) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5); display: flex; align-items: center;
        justify-content: center; z-index: 1000;
    `;

    const joursInterdits = rule.jours_interdits.split(',').map(j => parseInt(j.trim()));

    const content = document.createElement('div');
    content.style.cssText = `
        background: white; border-radius: 12px; padding: 2rem;
        max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;

    content.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h3>Modifier la méta-règle</h3>
            <button onclick="this.closest('div').remove()" style="background: #e53e3e; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">Fermer</button>
        </div>
        
        <form id="edit-meta-rule-form" style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div class="form-group">
                <label for="edit-rule-licence-type">Type de licence</label>
                <select id="edit-rule-licence-type" required>
                    <option value="Compétition" ${rule.licence_type === 'Compétition' ? 'selected' : ''}>Compétition</option>
                    <option value="Loisir/Senior" ${rule.licence_type === 'Loisir/Senior' ? 'selected' : ''}>Loisir/Senior</option>
                    <option value="Benjamins/Junior" ${rule.licence_type === 'Benjamins/Junior' ? 'selected' : ''}>Benjamins/Junior</option>
                    <option value="Poussins/Pupilles" ${rule.licence_type === 'Poussins/Pupilles' ? 'selected' : ''}>Poussins/Pupilles</option>
                </select>
            </div>
            <div class="form-group">
                <label for="edit-rule-jour-source">Si inscrit le</label>
                <select id="edit-rule-jour-source" required>
                    <option value="1" ${rule.jour_source === 1 ? 'selected' : ''}>Lundi</option>
                    <option value="2" ${rule.jour_source === 2 ? 'selected' : ''}>Mardi</option>
                    <option value="3" ${rule.jour_source === 3 ? 'selected' : ''}>Mercredi</option>
                    <option value="4" ${rule.jour_source === 4 ? 'selected' : ''}>Jeudi</option>
                    <option value="5" ${rule.jour_source === 5 ? 'selected' : ''}>Vendredi</option>
                    <option value="6" ${rule.jour_source === 6 ? 'selected' : ''}>Samedi</option>
                    <option value="0" ${rule.jour_source === 0 ? 'selected' : ''}>Dimanche</option>
                </select>
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
                <label>Alors interdire les jours</label>
                <div style="display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.5rem;">
                    <label style="display: flex; align-items: center; gap: 0.25rem;">
                        <input type="checkbox" name="edit-jours-interdits" value="1" ${joursInterdits.includes(1) ? 'checked' : ''}> Lundi
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.25rem;">
                        <input type="checkbox" name="edit-jours-interdits" value="2" ${joursInterdits.includes(2) ? 'checked' : ''}> Mardi
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.25rem;">
                        <input type="checkbox" name="edit-jours-interdits" value="3" ${joursInterdits.includes(3) ? 'checked' : ''}> Mercredi
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.25rem;">
                        <input type="checkbox" name="edit-jours-interdits" value="4" ${joursInterdits.includes(4) ? 'checked' : ''}> Jeudi
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.25rem;">
                        <input type="checkbox" name="edit-jours-interdits" value="5" ${joursInterdits.includes(5) ? 'checked' : ''}> Vendredi
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.25rem;">
                        <input type="checkbox" name="edit-jours-interdits" value="6" ${joursInterdits.includes(6) ? 'checked' : ''}> Samedi
                    </label>
                    <label style="display: flex; align-items: center; gap: 0.25rem;">
                        <input type="checkbox" name="edit-jours-interdits" value="0" ${joursInterdits.includes(0) ? 'checked' : ''}> Dimanche
                    </label>
                </div>
            </div>
            <div class="form-group" style="grid-column: 1 / -1;">
                <label for="edit-rule-description">Description de la règle</label>
                <textarea id="edit-rule-description" placeholder="Ex: Récupération obligatoire après séance intensive" rows="2">${rule.description || ''}</textarea>
            </div>
            <div style="grid-column: 1 / -1; display: flex; gap: 1rem;">
                <button type="submit" class="btn-success">Sauvegarder les modifications</button>
                <button type="button" onclick="this.closest('div').remove()" class="btn-warning">Annuler</button>
            </div>
        </form>
    `;

    modal.className = 'modal';
    modal.appendChild(content);
    document.body.appendChild(modal);

    // Ajouter l'event listener pour le formulaire d'édition
    const editForm = document.getElementById('edit-meta-rule-form');
    editForm.addEventListener('submit', (e) => handleEditMetaRule(e, rule.id, modal));

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

async function handleEditMetaRule(e, ruleId, modal) {
    e.preventDefault();

    const licence_type = document.getElementById('edit-rule-licence-type').value;
    const jour_source = parseInt(document.getElementById('edit-rule-jour-source').value);
    const description = document.getElementById('edit-rule-description').value;

    // Récupérer les jours interdits sélectionnés
    const joursInterditsCheckboxes = document.querySelectorAll('input[name="edit-jours-interdits"]:checked');
    const jours_interdits = Array.from(joursInterditsCheckboxes).map(cb => cb.value).join(',');

    if (!licence_type || jour_source === undefined || !jours_interdits) {
        showMessage('Veuillez remplir tous les champs obligatoires', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/admin/meta-rules/${ruleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licence_type, jour_source, jours_interdits, description })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Méta-règle modifiée avec succès', 'success');
            modal.remove();
            loadMetaRules();
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Erreur lors de la modification', 'error');
    }
}

async function deleteMetaRule(ruleId, licenceType, jourSource) {
    const confirmation = confirm(`Supprimer la règle pour "${licenceType}" (${jourSource}) ?`);
    if (!confirmation) return;

    try {
        const response = await fetch(`/api/admin/meta-rules/${ruleId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Méta-règle supprimée', 'success');
            loadMetaRules();
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Erreur lors de la suppression', 'error');
    }
}


// ===== FONCTIONS STATUT MÉTA-RÈGLES =====


function updateMetaRulesStatusDisplay(config) {
    const indicator = document.getElementById('meta-rules-indicator');
    const statusText = document.getElementById('meta-rules-status-text');

    if (!indicator || !statusText) return;

    if (config && config.enabled) {
        // Méta-règles activées
        indicator.style.background = '#10b981'; // Vert
        statusText.textContent = 'Activées';
        statusText.style.color = '#059669';
        statusText.style.fontWeight = '600';

        // Ajouter des informations supplémentaires si disponibles
        if (config.description) {
            statusText.textContent += ` • ${config.description}`;
        }
    } else if (config && !config.enabled) {
        // Méta-règles désactivées
        indicator.style.background = '#f59e0b'; // Orange
        statusText.textContent = 'Désactivées';
        statusText.style.color = '#d97706';
        statusText.style.fontWeight = '600';
    } else {
        // Pas de configuration ou erreur
        indicator.style.background = '#6b7280'; // Gris
        statusText.textContent = 'Non configurées';
        statusText.style.color = '#6b7280';
        statusText.style.fontWeight = '400';
    }
}

// Event listener pour le bouton d'actualisation du statut
document.addEventListener('DOMContentLoaded', () => {
    const refreshButton = document.getElementById('refresh-meta-rules-status');
    if (refreshButton) {
        refreshButton.addEventListener('click', () => {
            loadMetaRulesStatus();
            showMessage('Statut des méta-règles actualisé', 'success');
        });
    }
});