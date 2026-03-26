async function handleCreateCreneau(e) {
    e.preventDefault();

    const nom = document.getElementById('creneau-nom').value;
    const jour_semaine = document.getElementById('creneau-jour').value;
    const heure_debut = document.getElementById('creneau-debut').value;
    const heure_fin = document.getElementById('creneau-fin').value;
    const nombre_lignes = document.getElementById('creneau-lignes').value;
    const personnes_par_ligne = document.getElementById('creneau-personnes').value;

    const public_cible = document.getElementById('creneau-public-cible').value;

    try {
        const response = await fetch('/api/creneaux', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nom, jour_semaine, heure_debut, heure_fin, nombre_lignes, personnes_par_ligne, public_cible })
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
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Nombre de lignes</label>
                    <input type="number" id="edit-lignes" value="${creneau.nombre_lignes || 2}" min="1" required 
                           style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
                </div>
                <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Personnes par ligne</label>
                    <input type="number" id="edit-personnes" value="${creneau.personnes_par_ligne || 6}" min="1" required 
                           style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
                    <small style="color: #718096; font-size: 0.8rem;">
                        Capacité totale = lignes × personnes/ligne = ${(creneau.nombre_lignes || 2) * (creneau.personnes_par_ligne || 6)} places
                    </small>
                </div>
                
                <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;" for="edit-public-cible">Public cible :</label>
                    <select id="edit-public-cible" required style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
                        <option value="les deux" ${creneau.public_cible === 'les deux' ? 'selected' : ''}>Tous publics (Les deux)</option>
                        <option value="adulte" ${creneau.public_cible === 'adulte' ? 'selected' : ''}>Adultes uniquement</option>
                        <option value="jeune" ${creneau.public_cible === 'jeune' ? 'selected' : ''}>Jeunes uniquement</option>
                    </select>
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

            const public_cible = document.getElementById('edit-public-cible').value;

            const formData = {
                nom: document.getElementById('edit-nom').value,
                jour_semaine: document.getElementById('edit-jour').value,
                heure_debut: document.getElementById('edit-debut').value,
                heure_fin: document.getElementById('edit-fin').value,
                nombre_lignes: parseInt(document.getElementById('edit-lignes').value),
                personnes_par_ligne: parseInt(document.getElementById('edit-personnes').value),
                public_cible: public_cible
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
async function handleCreateUser(e) {
    e.preventDefault();

    const prenom = document.getElementById('create-user-prenom').value;
    const nom = document.getElementById('create-user-nom').value;
    const email = document.getElementById('create-user-email').value;
    const password = document.getElementById('create-user-password').value;
    const licence_type = document.getElementById('create-user-licence').value;
    const public_cible = document.getElementById('create-user-cible').value;
    const role = document.getElementById('create-user-role').value;

    try {
        const response = await fetch('/api/admin/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prenom, nom, email, password, licence_type, public_cible, role })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(data.message || 'Utilisateur créé avec succès', 'success');
            document.getElementById('create-user-form').reset();
            loadAdminUsers();
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        console.error('Erreur création utilisateur:', error);
        showMessage("Erreur lors de la création de l'utilisateur", 'error');
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

async function changerPublicCibleUtilisateur(userId, nouveauPublicCible) {
    if (!nouveauPublicCible) return;

    const nomPublic = nouveauPublicCible === 'jeune' ? 'Jeune' :
        nouveauPublicCible === 'adulte' ? 'Adulte' : 'Tous publics (Les deux)';

    const confirmation = confirm(
        `Êtes-vous sûr de vouloir modifier le public cible de cet utilisateur vers "${nomPublic}" ?`
    );

    if (!confirmation) {
        loadAdminUsers();
        return;
    }

    try {
        const response = await fetch(`/api/admin/users/${userId}/role`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_cible: nouveauPublicCible })
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
        console.error('Erreur lors du changement de public cible:', error);
        showMessage('Erreur lors du changement de public cible', 'error');
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


// ===== FONCTIONS GESTION DES BLOCS =====

async function loadBlocs() {
    try {
        const response = await fetch('/api/admin/blocs');
        const blocs = await response.json();

        if (response.ok) {
            displayBlocs(blocs);
        } else {
            showMessage('Erreur lors du chargement des blocs', 'error');
        }
    } catch (error) {
        console.error('Erreur chargement blocs:', error);
        showMessage('Erreur de connexion', 'error');
    }
}

async function handleCreateBloc(e) {
    e.preventDefault();

    const nom = document.getElementById('bloc-nom').value;
    const description = document.getElementById('bloc-description').value;

    try {
        const response = await fetch('/api/admin/blocs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nom, description })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Bloc créé avec succès', 'success');
            document.getElementById('create-bloc-form').reset();
            loadBlocs();
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Erreur lors de la création du bloc', 'error');
    }
}

async function deleteBloc(blocId, blocNom) {
    const confirmation = confirm(
        `Supprimer le bloc "${blocNom}" ?\n\n` +
        `⚠️ Les créneaux ne seront pas supprimés, mais ne seront plus associés à ce bloc.`
    );

    if (!confirmation) return;

    try {
        const response = await fetch(`/api/admin/blocs/${blocId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Bloc supprimé', 'success');
            loadBlocs();
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Erreur lors de la suppression', 'error');
    }
}

async function editBloc(blocId) {
    try {
        const response = await fetch(`/api/admin/blocs/${blocId}`);
        const bloc = await response.json();

        if (!response.ok) {
            showMessage('Erreur lors du chargement du bloc', 'error');
            return;
        }

        showEditBlocModal(bloc);
    } catch (error) {
        showMessage('Erreur lors du chargement du bloc', 'error');
    }
}

function showEditBlocModal(bloc) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5); display: flex; align-items: center;
        justify-content: center; z-index: 1000;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: white; border-radius: 12px; padding: 2rem;
        max-width: 500px; width: 90%;
    `;

    content.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h3>Modifier le bloc</h3>
            <button onclick="this.closest('div').parentElement.remove()" style="background: #e53e3e; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">Fermer</button>
        </div>
        
        <form id="edit-bloc-form">
            <div style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Nom du bloc</label>
                <input type="text" id="edit-bloc-nom" value="${bloc.nom}" required 
                       style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
            </div>
            
            <div style="margin-bottom: 1.5rem;">
                <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Description</label>
                <input type="text" id="edit-bloc-description" value="${bloc.description || ''}"
                       style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
            </div>
            
            <div style="display: flex; gap: 1rem; justify-content: flex-end;">
                <button type="button" onclick="this.closest('div').parentElement.parentElement.remove()" 
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

    modal.appendChild(content);
    document.body.appendChild(modal);

    document.getElementById('edit-bloc-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = {
            nom: document.getElementById('edit-bloc-nom').value,
            description: document.getElementById('edit-bloc-description').value
        };

        try {
            const response = await fetch(`/api/admin/blocs/${bloc.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (response.ok) {
                showMessage('Bloc modifié avec succès', 'success');
                modal.remove();
                loadBlocs();
            } else {
                showMessage(result.error, 'error');
            }
        } catch (error) {
            showMessage('Erreur lors de la modification', 'error');
        }
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

async function manageCreneauxBloc(blocId, blocNom) {
    try {
        // Récupérer tous les créneaux
        const creneauxResponse = await fetch('/api/creneaux');
        const creneaux = await creneauxResponse.json();

        // Récupérer les créneaux du bloc
        const blocCreneauxResponse = await fetch(`/api/admin/blocs/${blocId}/creneaux`);
        const blocCreneaux = await blocCreneauxResponse.json();

        const blocCreneauxIds = blocCreneaux.map(c => c.id);

        showManageCreneauxModal(blocId, blocNom, creneaux, blocCreneauxIds);
    } catch (error) {
        showMessage('Erreur lors du chargement', 'error');
    }
}

function showManageCreneauxModal(blocId, blocNom, creneaux, blocCreneauxIds) {
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

    const joursNoms = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

    content.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h3>Créneaux du bloc "${blocNom}"</h3>
            <button onclick="this.closest('div').parentElement.remove()" style="background: #e53e3e; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer;">Fermer</button>
        </div>
        
        <p style="color: #718096; margin-bottom: 1rem;">Cochez les créneaux qui appartiennent à ce bloc :</p>
        
        <form id="manage-creneaux-form">
            ${creneaux.map(c => `
                <label style="display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 0.5rem; cursor: pointer;">
                    <input type="checkbox" value="${c.id}" ${blocCreneauxIds.includes(c.id) ? 'checked' : ''}>
                    <span>${c.nom} - ${joursNoms[c.jour_semaine]} ${c.heure_debut}-${c.heure_fin}</span>
                </label>
            `).join('')}
            
            <div style="margin-top: 1.5rem; display: flex; gap: 1rem; justify-content: flex-end;">
                <button type="button" onclick="this.closest('div').parentElement.parentElement.remove()" 
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

    modal.appendChild(content);
    document.body.appendChild(modal);

    document.getElementById('manage-creneaux-form').addEventListener('submit', async (e) => {
        e.preventDefault();

        const checkboxes = document.querySelectorAll('#manage-creneaux-form input[type="checkbox"]:checked');
        const creneauxIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

        try {
            const response = await fetch(`/api/admin/blocs/${blocId}/creneaux`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ creneauxIds })
            });

            const result = await response.json();

            if (response.ok) {
                showMessage('Créneaux du bloc mis à jour', 'success');
                modal.remove();
                loadBlocs();
            } else {
                showMessage(result.error, 'error');
            }
        } catch (error) {
            showMessage('Erreur lors de la mise à jour', 'error');
        }
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}
