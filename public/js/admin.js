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
async function voirInscriptions(creneauId) {
    try {
        const response = await fetch(`/api/admin/inscriptions/${creneauId}`);
        const data = await response.json();

        if (response.ok) {
            displayInscriptionsModal(data, creneauId);
        } else {
            showMessage('Erreur lors du chargement des inscriptions', 'error');
        }
    } catch (error) {
        showMessage('Erreur de connexion', 'error');
    }
}
async function desinscrireUtilisateur(userId, creneauId, nomUtilisateur) {
    const confirmation = confirm(`Désinscrire ${nomUtilisateur} de ce créneau ?`);
    if (!confirmation) return;

    try {
        const response = await fetch(`/api/admin/inscriptions/${userId}/${creneauId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(data.message, 'success');
            // Recharger la modal des inscriptions
            voirInscriptions(creneauId);
            // Recharger les listes
            loadAdminCreneaux();
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        console.error('Erreur désinscription:', error);
        showMessage('Erreur lors de la désinscription', 'error');
    }
}
async function inscrireUtilisateur(creneauId) {
    const email = document.getElementById('email-inscription').value;
    if (!email) {
        showMessage('Veuillez saisir un email', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/admin/inscriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, creneauId })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(data.message, 'success');
            document.getElementById('email-inscription').value = '';
            // Recharger la modal des inscriptions
            voirInscriptions(creneauId);
            // Recharger les listes
            loadAdminCreneaux();
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        console.error('Erreur inscription:', error);
        showMessage('Erreur lors de l\'inscription', 'error');
    }
}
async function promouvoirUtilisateur(userId, creneauId, nomUtilisateur) {
    const confirmation = confirm(`Promouvoir ${nomUtilisateur} de la liste d'attente vers les inscrits ?`);
    if (!confirmation) return;

    try {
        const response = await fetch(`/api/admin/inscriptions/${userId}/${creneauId}/promote`, {
            method: 'PUT'
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(data.message, 'success');
            // Recharger la modal des inscriptions
            voirInscriptions(creneauId);
            // Recharger les listes
            loadAdminCreneaux();
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        console.error('Erreur promotion:', error);
        showMessage('Erreur lors de la promotion', 'error');
    }
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
async function changerLicenceUtilisateur(userId, nouvelleLicence) {
    if (!nouvelleLicence) return;

    const confirmation = confirm(
        `Êtes-vous sûr de vouloir changer le type de licence vers "${nouvelleLicence}" ?\n\n` +
        `Cela modifiera immédiatement les limites de séances de cet utilisateur.`
    );

    if (!confirmation) {
        loadAdminUsers();
        return;
    }

    try {
        const response = await fetch(`/api/admin/users/${userId}/licence`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licence_type: nouvelleLicence })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(data.message, 'success');
            loadAdminUsers();
        } else {
            showMessage(data.error, 'error');
            loadAdminUsers();
        }
    } catch (error) {
        console.error('Erreur lors du changement de licence:', error);
        showMessage('Erreur lors du changement de licence', 'error');
        loadAdminUsers();
    }
}
async function reinitialiserMotDePasse(userId, nomUtilisateur) {
    const nouveauMotDePasse = prompt(
        `Réinitialisation du mot de passe pour ${nomUtilisateur}\n\n` +
        `Entrez le nouveau mot de passe (minimum 6 caractères) :`
    );

    if (!nouveauMotDePasse) return;

    if (nouveauMotDePasse.length < 6) {
        showMessage('Le mot de passe doit contenir au moins 6 caractères', 'error');
        return;
    }

    const confirmation = confirm(
        `Confirmer la réinitialisation du mot de passe pour ${nomUtilisateur} ?\n\n` +
        `Nouveau mot de passe : ${nouveauMotDePasse}`
    );

    if (!confirmation) return;

    try {
        const response = await fetch(`/api/admin/users/${userId}/reset-password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nouveauMotDePasse })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(`${data.message} - Nouveau mot de passe : ${nouveauMotDePasse}`, 'success');
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        console.error('Erreur lors de la réinitialisation:', error);
        showMessage('Erreur lors de la réinitialisation du mot de passe', 'error');
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
async function remiseAZeroHebdomadaire() {
    const confirmation = confirm(
        '⚠️ ATTENTION - REMISE À ZÉRO HEBDOMADAIRE ⚠️\n\n' +
        'Cette action va :\n' +
        '• Désinscrire TOUS les utilisateurs de TOUS les créneaux\n' +
        '• Vider toutes les listes d\'attente\n' +
        '• Remettre les compteurs à zéro\n\n' +
        'Cette action est IRRÉVERSIBLE !\n\n' +
        'Êtes-vous absolument sûr de vouloir continuer ?'
    );

    if (!confirmation) return;

    // Double confirmation pour éviter les erreurs
    const doubleConfirmation = confirm(
        'DERNIÈRE CONFIRMATION\n\n' +
        'Vous allez supprimer TOUTES les inscriptions de TOUS les créneaux.\n' +
        'Tous les utilisateurs devront se réinscrire.\n\n' +
        'Tapez "VIDER TOUT" dans la prochaine boîte de dialogue pour procéder.'
    );

    if (!doubleConfirmation) return;

    const motConfirmation = prompt(
        'Pour confirmer définitivement, tapez exactement : VIDER TOUT'
    );

    if (motConfirmation !== 'VIDER TOUT') {
        showMessage('Remise à zéro annulée - mot de confirmation incorrect', 'error');
        return;
    }

    try {
        console.log('🔄 Début de la remise à zéro hebdomadaire...');

        const response = await fetch('/api/admin/reset-weekly', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(
                `✅ Remise à zéro réussie ! ${data.inscriptionsSupprimes} inscription(s) supprimée(s). ` +
                `Tous les créneaux sont maintenant vides.`,
                'success'
            );

            // Recharger toutes les listes pour refléter les changements
            loadAdminCreneaux();
            loadCreneaux(); // Mettre à jour la vue utilisateur aussi

            console.log('✅ Remise à zéro hebdomadaire terminée');
        } else {
            showMessage(`Erreur lors de la remise à zéro : ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Erreur remise à zéro:', error);
        showMessage('Erreur de connexion lors de la remise à zéro', 'error');
    }
}
async function loadMetaRulesConfig() {
    try {
        const response = await fetch('/api/admin/meta-rules-config');
        const config = await response.json();

        if (response.ok) {
            document.getElementById('meta-rules-enabled').checked = config.enabled || false;
            document.getElementById('meta-rules-description').value = config.description || '';
        }
    } catch (error) {
        console.error('Erreur chargement config méta-règles:', error);
    }
}
async function updateMetaRulesConfig() {
    const enabled = document.getElementById('meta-rules-enabled').checked;
    const description = document.getElementById('meta-rules-description').value;

    try {
        const response = await fetch('/api/admin/meta-rules-config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled, description })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Configuration des méta-règles mise à jour', 'success');
            loadMetaRulesStatus(); // Mettre à jour le statut affiché
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Erreur lors de la mise à jour', 'error');
    }
}
async function loadMetaRules() {
    try {
        const response = await fetch('/api/admin/meta-rules');
        const rules = await response.json();

        if (response.ok) {
            displayMetaRules(rules);
        }
    } catch (error) {
        console.error('Erreur chargement méta-règles:', error);
    }
}
async function handleCreateMetaRule(e) {
    e.preventDefault();

    const licence_type = document.getElementById('rule-licence-type').value;
    const jour_source = parseInt(document.getElementById('rule-jour-source').value);
    const description = document.getElementById('rule-description').value;

    // Récupérer les jours interdits sélectionnés
    const joursInterditsCheckboxes = document.querySelectorAll('input[name="jours-interdits"]:checked');
    const jours_interdits = Array.from(joursInterditsCheckboxes).map(cb => cb.value).join(',');

    if (!licence_type || jour_source === undefined || !jours_interdits) {
        showMessage('Veuillez remplir tous les champs obligatoires', 'error');
        return;
    }

    try {
        const response = await fetch('/api/admin/meta-rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licence_type, jour_source, jours_interdits, description })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Méta-règle créée avec succès', 'success');
            document.getElementById('create-meta-rule-form').reset();
            loadMetaRules();
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Erreur lors de la création', 'error');
    }
}
async function toggleMetaRule(ruleId) {
    try {
        const response = await fetch(`/api/admin/meta-rules/${ruleId}/toggle`, {
            method: 'PUT'
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Statut de la règle mis à jour', 'success');
            loadMetaRules();
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Erreur lors de la mise à jour', 'error');
    }
}
async function loadMetaRulesStatus() {
    try {
        const response = await fetch('/api/admin/meta-rules-config');
        const data = await response.json();

        if (response.ok) {
            updateMetaRulesStatusDisplay(data);
        } else {
            updateMetaRulesStatusDisplay(null);
        }
    } catch (error) {
        console.error('Erreur lors du chargement du statut des méta-règles:', error);
        updateMetaRulesStatusDisplay(null);
    }
}