// Seule la natation se décrit en lignes d'eau ; les autres sports ont une
// capacité directe. Le formulaire s'adapte au sport choisi.
function estSportAvecLignesEau(sportId) {
    const sport = sports.find(s => String(s.id) === String(sportId));
    return !!sport && sport.slug === 'natation';
}

function majChampsCapacite() {
    const sportId = document.getElementById('creneau-sport').value;
    const lignesEau = estSportAvecLignesEau(sportId);

    const champLignes = document.getElementById('creneau-lignes');
    const champPersonnes = document.getElementById('creneau-personnes');
    const champCapacite = document.getElementById('creneau-capacite');
    const labelSansLimite = document.getElementById('creneau-sans-limite-label');
    const caseSansLimite = document.getElementById('creneau-sans-limite');

    champLignes.style.display = lignesEau ? '' : 'none';
    champPersonnes.style.display = lignesEau ? '' : 'none';
    champCapacite.style.display = lignesEau ? 'none' : '';

    // « Sans limite » n'a de sens que hors natation : une ligne d'eau a toujours une capacité
    labelSansLimite.style.display = lignesEau || !sportId ? 'none' : 'flex';
    if (lignesEau) caseSansLimite.checked = false;

    // La capacité reste facultative hors natation : le sport fournit une valeur par défaut
    champLignes.required = lignesEau;
    champPersonnes.required = lignesEau;
    champCapacite.required = false;

    const sport = sports.find(s => String(s.id) === String(sportId));
    champCapacite.placeholder = sport && sport.capacite_defaut
        ? `Capacité (par défaut : ${sport.capacite_defaut})`
        : 'Capacité (nb de places)';

    // La capacité n'a plus d'objet quand le créneau est sans limite
    champCapacite.disabled = caseSansLimite.checked;
    if (caseSansLimite.checked) champCapacite.value = '';

    // Éviter d'envoyer les valeurs du mode précédent
    if (lignesEau) {
        champCapacite.value = '';
    } else {
        champLignes.value = '';
        champPersonnes.value = '';
    }
}

async function remplirSelecteurSports() {
    const select = document.getElementById('creneau-sport');
    if (!select) return;

    if (!sports.length) {
        await loadSports();
    }

    select.innerHTML = '<option value="">Sport</option>' +
        sports.map(s => `<option value="${s.id}">${s.icone} ${s.nom}</option>`).join('');

    select.addEventListener('change', majChampsCapacite);
    document.getElementById('creneau-sans-limite').addEventListener('change', majChampsCapacite);
    majChampsCapacite();

    // La remise à zéro peut cibler une discipline précise
    const selectReset = document.getElementById('reset-sport');
    if (selectReset) {
        selectReset.innerHTML = '<option value="">Toutes les disciplines</option>' +
            sports.map(s => `<option value="${s.id}">${s.icone} ${s.nom}</option>`).join('');
    }

    await chargerLieuxConnus();
}

// Alimente les suggestions de lieu à partir de ceux déjà saisis
async function chargerLieuxConnus() {
    const datalist = document.getElementById('lieux-connus');
    if (!datalist) return;

    try {
        const response = await fetch('/api/admin/lieux');
        if (!response.ok) return;

        const lieux = await response.json();
        datalist.innerHTML = lieux.map(l => `<option value="${l.replace(/"/g, '&quot;')}"></option>`).join('');
    } catch (error) {
        // Sans suggestions, la saisie libre reste possible
        console.error('Erreur chargement des lieux:', error);
    }
}

async function handleCreateCreneau(e) {
    e.preventDefault();

    const nom = document.getElementById('creneau-nom').value;
    const sport_id = document.getElementById('creneau-sport').value;
    const jour_semaine = document.getElementById('creneau-jour').value;
    const heure_debut = document.getElementById('creneau-debut').value;
    const heure_fin = document.getElementById('creneau-fin').value;
    const nombre_lignes = document.getElementById('creneau-lignes').value;
    const personnes_par_ligne = document.getElementById('creneau-personnes').value;
    const capacite_max = document.getElementById('creneau-capacite').value;
    const sans_limite = document.getElementById('creneau-sans-limite').checked;
    const lieu = document.getElementById('creneau-lieu').value;

    const public_cible = document.getElementById('creneau-public-cible').value;

    try {
        const response = await fetch('/api/creneaux', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nom, sport_id, jour_semaine, heure_debut, heure_fin, nombre_lignes, personnes_par_ligne,
                capacite_max, sans_limite, lieu, public_cible, semaine_type_id: semaineTypeCourante
            })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('Créneau créé avec succès', 'success');
            document.getElementById('create-creneau-form').reset();
            majChampsCapacite(); // Le reset vide le sport : réafficher l'état neutre
            chargerLieuxConnus(); // Un nouveau lieu devient une suggestion
            chargerSemainesTypes(); // nombre de créneaux par semaine type
            chargerPlanning();
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Erreur lors de la création du créneau', 'error');
    }
}
async function loadAdminCreneaux() {
    try {
        const filtre = semaineTypeCourante ? `?semaine_type=${semaineTypeCourante}` : '';
        const response = await fetch(`/api/creneaux${filtre}`);
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
async function voirInscriptions(seanceId) {
    try {
        const response = await fetch(`/api/admin/seances/${seanceId}/inscriptions`);
        const data = await response.json();

        if (response.ok) {
            displayInscriptionsModal(data, seanceId);
        } else {
            showMessage('Erreur lors du chargement des inscriptions', 'error');
        }
    } catch (error) {
        showMessage('Erreur de connexion', 'error');
    }
}
async function desinscrireUtilisateur(userId, seanceId, nomUtilisateur) {
    const confirmation = confirm(`Désinscrire ${nomUtilisateur} de ce créneau ?`);
    if (!confirmation) return;

    try {
        const response = await fetch(`/api/admin/seances/${seanceId}/inscriptions/${userId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(data.message, 'success');
            // Recharger la modal des inscriptions
            voirInscriptions(seanceId);
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
async function inscrireUtilisateur(seanceId) {
    const email = document.getElementById('email-inscription').value;
    if (!email) {
        showMessage('Veuillez saisir un email', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/admin/inscriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, seanceId })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(data.message, 'success');
            document.getElementById('email-inscription').value = '';
            // Recharger la modal des inscriptions
            voirInscriptions(seanceId);
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
async function promouvoirUtilisateur(userId, seanceId, nomUtilisateur) {
    const confirmation = confirm(`Promouvoir ${nomUtilisateur} de la liste d'attente vers les inscrits ?`);
    if (!confirmation) return;

    try {
        const response = await fetch(`/api/admin/seances/${seanceId}/inscriptions/${userId}/promote`, {
            method: 'PUT'
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(data.message, 'success');
            // Recharger la modal des inscriptions
            voirInscriptions(seanceId);
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
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Sport</label>
                    <select id="edit-sport" required style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
                        ${sports.map(s => `<option value="${s.id}" ${String(creneau.sport_id) === String(s.id) ? 'selected' : ''}>${s.icone} ${s.nom}</option>`).join('')}
                    </select>
                    <small style="color: #718096; font-size: 0.8rem;">
                        Changer de sport retire le créneau des blocs hebdomadaires d'une autre discipline.
                    </small>
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
                
                <div id="edit-bloc-lignes">
                    <div style="margin-bottom: 1.5rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Nombre de lignes</label>
                        <input type="number" id="edit-lignes" value="${creneau.nombre_lignes || 2}" min="1"
                               style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
                    </div>
                    <div style="margin-bottom: 1.5rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Personnes par ligne</label>
                        <input type="number" id="edit-personnes" value="${creneau.personnes_par_ligne || 6}" min="1"
                               style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
                        <small style="color: #718096; font-size: 0.8rem;">
                            Capacité totale = lignes × personnes/ligne
                        </small>
                    </div>
                </div>

                <div id="edit-bloc-capacite" style="margin-bottom: 1.5rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Capacité (nb de places)</label>
                    <input type="number" id="edit-capacite" value="${creneau.capacite_max || ''}" min="1"
                           style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
                    <label style="display: flex; align-items: center; gap: 0.5rem; margin-top: 0.75rem; font-size: 0.9rem; color: #4a5568;">
                        <input type="checkbox" id="edit-sans-limite" style="width: auto;"
                               ${(creneau.sans_limite === true || creneau.sans_limite === 1) ? 'checked' : ''}>
                        Sans limite de places
                    </label>
                </div>

                <div style="margin-bottom: 1.5rem;">
                    <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Lieu</label>
                    <input type="text" id="edit-lieu" value="${(creneau.lieu || '').replace(/"/g, '&quot;')}"
                           placeholder="Piscine, gymnase, point de départ... (facultatif)" list="lieux-connus"
                           style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 6px;">
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

        // Le formulaire suit le sport sélectionné, comme à la création
        const selectSport = document.getElementById('edit-sport');
        const caseSansLimiteEdit = document.getElementById('edit-sans-limite');

        const majChampsEdition = () => {
            const lignesEau = estSportAvecLignesEau(selectSport.value);
            document.getElementById('edit-bloc-lignes').style.display = lignesEau ? '' : 'none';
            document.getElementById('edit-bloc-capacite').style.display = lignesEau ? 'none' : '';

            const champCap = document.getElementById('edit-capacite');
            champCap.disabled = caseSansLimiteEdit.checked;
            if (caseSansLimiteEdit.checked) champCap.value = '';

            if (lignesEau) caseSansLimiteEdit.checked = false;
        };

        selectSport.addEventListener('change', majChampsEdition);
        caseSansLimiteEdit.addEventListener('change', majChampsEdition);
        majChampsEdition();

        // Gérer la soumission du formulaire
        document.getElementById('edit-creneau-form').addEventListener('submit', async (e) => {
            e.preventDefault();

            const public_cible = document.getElementById('edit-public-cible').value;
            const lignesEau = estSportAvecLignesEau(selectSport.value);

            const formData = {
                nom: document.getElementById('edit-nom').value,
                sport_id: selectSport.value,
                jour_semaine: document.getElementById('edit-jour').value,
                heure_debut: document.getElementById('edit-debut').value,
                heure_fin: document.getElementById('edit-fin').value,
                // Les lignes d'eau ne sont transmises que pour la natation
                nombre_lignes: lignesEau ? parseInt(document.getElementById('edit-lignes').value) : null,
                personnes_par_ligne: lignesEau ? parseInt(document.getElementById('edit-personnes').value) : null,
                capacite_max: lignesEau ? null : document.getElementById('edit-capacite').value,
                sans_limite: caseSansLimiteEdit.checked,
                lieu: document.getElementById('edit-lieu').value,
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
    const selectSport = document.getElementById('reset-sport');
    const sportId = selectSport ? selectSport.value : '';
    const sportNom = sportId && selectSport
        ? selectSport.options[selectSport.selectedIndex].textContent.trim()
        : null;

    // Le libellé suit la portée réelle : une discipline, ou toutes
    const portee = sportNom
        ? `des séances de ${sportNom} de la semaine en cours`
        : 'de TOUTES les séances de la semaine en cours';
    const motAttendu = sportNom ? 'VIDER' : 'VIDER TOUT';

    const confirmation = confirm(
        '⚠️ ATTENTION - REMISE À ZÉRO HEBDOMADAIRE ⚠️\n\n' +
        'Cette action va :\n' +
        `• Désinscrire tous les utilisateurs ${portee}\n` +
        '• Vider les listes d\'attente correspondantes\n' +
        '• Remettre les compteurs à zéro\n' +
        '(les réservations des semaines suivantes sont conservées)\n\n' +
        'Cette action est IRRÉVERSIBLE !\n\n' +
        'Êtes-vous absolument sûr de vouloir continuer ?'
    );

    if (!confirmation) return;

    // Double confirmation pour éviter les erreurs
    const doubleConfirmation = confirm(
        'DERNIÈRE CONFIRMATION\n\n' +
        `Vous allez supprimer toutes les inscriptions ${portee}.\n` +
        'Les utilisateurs concernés devront se réinscrire.\n\n' +
        `Tapez "${motAttendu}" dans la prochaine boîte de dialogue pour procéder.`
    );

    if (!doubleConfirmation) return;

    const motConfirmation = prompt(
        `Pour confirmer définitivement, tapez exactement : ${motAttendu}`
    );

    if (motConfirmation !== motAttendu) {
        showMessage('Remise à zéro annulée - mot de confirmation incorrect', 'error');
        return;
    }

    try {
        console.log('🔄 Début de la remise à zéro hebdomadaire...');

        const response = await fetch('/api/admin/reset-weekly', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sportId ? { sport_id: sportId } : {})
        });

        const data = await response.json();

        if (response.ok) {
            showMessage(`✅ ${data.message}`, 'success');

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

        // Un bloc ne regroupe que des créneaux de son sport : ne proposer que ceux-là
        const blocsResponse = await fetch('/api/admin/blocs');
        const blocs = await blocsResponse.json();
        const bloc = blocs.find(b => String(b.id) === String(blocId));

        const creneauxEligibles = bloc && bloc.sport_id
            ? creneaux.filter(c => String(c.sport_id) === String(bloc.sport_id))
            : creneaux;

        showManageCreneauxModal(blocId, blocNom, creneauxEligibles, blocCreneauxIds);
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
                    <span>${c.nom} - ${joursNoms[c.jour_semaine]} ${c.heure_debut}-${c.heure_fin}${semainesTypes.length > 1 && c.semaine_type_nom ? ` <small style="color:#718096;">· ${c.semaine_type_nom}</small>` : ''}</span>
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

// --- IMPORT DE COMPTES (CSV / EXCEL) ---

// SheetJS n'est chargé qu'à la première utilisation : inutile de l'imposer
// à chaque visiteur de l'application.
const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let sheetJsChargement = null;

let importLignesBrutes = null; // lignes du fichier, telles que lues
let importAnalyse = null;      // dernière analyse renvoyée par le serveur
// Corrections manuelles par numéro de ligne, réappliquées quand un changement
// de valeur par défaut relance l'analyse du fichier
let importCorrections = {};

const LIBELLES_STATUT_IMPORT = {
    nouveau: { texte: 'À créer', couleur: '#2f855a' },
    existant: { texte: 'Compte existant', couleur: '#2b6cb0' },
    doublon: { texte: 'Doublon dans le fichier', couleur: '#b7791f' },
    erreur: { texte: 'Erreur', couleur: '#c53030' }
};

const LICENCES_IMPORT = ['Compétition', 'Loisir/Senior', 'Benjamins/Junior', 'Poussins/Pupilles'];
const PUBLICS_IMPORT = [['adulte', 'Adulte'], ['jeune', 'Jeune'], ['les deux', 'Les deux']];

function echapperHtml(texte) {
    const div = document.createElement('div');
    div.textContent = texte ?? '';
    return div.innerHTML.replace(/"/g, '&quot;');
}

function initImportComptes() {
    const inputFichier = document.getElementById('import-fichier');
    // Appelée à chaque affichage de l'interface : ne brancher qu'une fois
    if (!inputFichier || inputFichier.dataset.pret) return;
    inputFichier.dataset.pret = '1';

    inputFichier.addEventListener('change', () => {
        if (inputFichier.files[0]) chargerFichierImport(inputFichier.files[0]);
    });

    // Changer une valeur par défaut relance l'analyse du fichier déjà chargé
    ['import-defaut-licence', 'import-defaut-public'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => {
            if (importLignesBrutes) analyserFichierImport();
        });
    });

    document.getElementById('import-modele-link').addEventListener('click', (e) => {
        e.preventDefault();
        telechargerModeleImport();
    });
}

function chargerSheetJS() {
    if (window.XLSX) return Promise.resolve();
    if (!sheetJsChargement) {
        sheetJsChargement = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = SHEETJS_URL;
            script.onload = resolve;
            script.onerror = () => {
                sheetJsChargement = null;
                reject(new Error('Impossible de charger le lecteur de fichiers'));
            };
            document.head.appendChild(script);
        });
    }
    return sheetJsChargement;
}

// Les exports CSV sont souvent en Windows-1252 (Excel français) : on tente
// l'UTF-8 strict, puis on se rabat sur cet encodage.
function decoderTexteCsv(buffer) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        return new TextDecoder('windows-1252').decode(buffer);
    }
}

async function lireFichierImport(fichier) {
    await chargerSheetJS();
    const buffer = await fichier.arrayBuffer();

    // raw : garder les valeurs telles quelles (pas de conversion en nombre ou en date)
    const classeur = /\.csv$/i.test(fichier.name)
        ? XLSX.read(decoderTexteCsv(buffer), { type: 'string', raw: true })
        : XLSX.read(buffer, { type: 'array' });

    const feuille = classeur.Sheets[classeur.SheetNames[0]];
    // blankrows : conserver les lignes vides pour que les numéros de ligne
    // affichés correspondent à ceux du fichier (le serveur les écarte)
    return XLSX.utils.sheet_to_json(feuille, { defval: '', raw: false, blankrows: true });
}

async function chargerFichierImport(fichier) {
    const zone = document.getElementById('import-apercu');
    zone.innerHTML = '<p>Lecture du fichier…</p>';
    importLignesBrutes = null;
    importAnalyse = null;
    importCorrections = {};

    try {
        const lignes = await lireFichierImport(fichier);
        if (lignes.length === 0) {
            zone.innerHTML = '<p style="color:#c53030;">Le fichier ne contient aucune ligne.</p>';
            return;
        }
        importLignesBrutes = lignes;
        await analyserFichierImport();
    } catch (error) {
        console.error('Erreur lecture fichier import:', error);
        zone.innerHTML = `<p style="color:#c53030;">Fichier illisible : ${echapperHtml(error.message)}</p>`;
    }
}

async function analyserFichierImport() {
    const zone = document.getElementById('import-apercu');
    const defauts = {
        licence_type: document.getElementById('import-defaut-licence').value,
        public_cible: document.getElementById('import-defaut-public').value
    };

    try {
        const response = await fetch('/api/admin/users/import/apercu', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lignes: importLignesBrutes, defauts })
        });
        const data = await response.json();

        if (!response.ok) {
            zone.innerHTML = `<p style="color:#c53030;">${echapperHtml(data.error)}</p>`;
            return;
        }
        importAnalyse = data.lignes.map(l => ({ ...l, ...importCorrections[l.ligne] }));
        if (Object.keys(importCorrections).length > 0) {
            await revaliderImport();
        } else {
            afficherApercuImport(data.resume);
        }
    } catch (error) {
        zone.innerHTML = '<p style="color:#c53030;">Erreur de connexion</p>';
    }
}

// Une licence ou un public corrigé à la main : le serveur revalide la ligne
async function corrigerLigneImport(index, champ, valeur) {
    const ligne = importAnalyse[index];
    ligne[champ] = valeur || null;
    importCorrections[ligne.ligne] = { ...importCorrections[ligne.ligne], [champ]: ligne[champ] };
    await revaliderImport();
}

async function revaliderImport() {
    try {
        const response = await fetch('/api/admin/users/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lignes: importAnalyse, simulation: true })
        });
        const data = await response.json();

        if (response.ok) {
            importAnalyse = data.lignes;
            afficherApercuImport(data.resume);
        } else {
            showMessage(data.error, 'error');
        }
    } catch (error) {
        showMessage('Erreur de connexion', 'error');
    }
}

function selecteurImport(index, champ, options, valeur) {
    const choix = options.map(([v, libelle]) =>
        `<option value="${echapperHtml(v)}" ${v === valeur ? 'selected' : ''}>${echapperHtml(libelle)}</option>`
    ).join('');
    const vide = champ === 'licence_type' && !valeur ? '<option value="" selected>— À choisir —</option>' : '';
    return `<select onchange="corrigerLigneImport(${index}, '${champ}', this.value)">${vide}${choix}</select>`;
}

function afficherApercuImport(resume) {
    const zone = document.getElementById('import-apercu');
    // Garder l'état des cases à cocher entre deux rafraîchissements
    const majExistants = document.getElementById('import-maj-existants')?.checked ?? false;
    const envoyerEmails = document.getElementById('import-envoyer-emails')?.checked ?? true;

    const pastille = (statut) => {
        const { texte, couleur } = LIBELLES_STATUT_IMPORT[statut];
        return `<span style="background:${couleur};color:white;border-radius:999px;padding:2px 8px;font-size:0.75rem;white-space:nowrap;">${texte}</span>`;
    };

    const lignesHtml = importAnalyse.map((l, i) => `
        <tr style="border-top:1px solid #e2e8f0;">
            <td>${l.ligne}</td>
            <td>${pastille(l.statut)}</td>
            <td>${echapperHtml(l.nom)}</td>
            <td>${echapperHtml(l.prenom)}</td>
            <td>${echapperHtml(l.email)}</td>
            <td>${selecteurImport(i, 'licence_type', LICENCES_IMPORT.map(x => [x, x]), l.licence_type)}</td>
            <td>${selecteurImport(i, 'public_cible', PUBLICS_IMPORT, l.public_cible)}</td>
            <td style="color:#c53030;font-size:0.85rem;">${l.erreurs.map(echapperHtml).join('<br>')}</td>
        </tr>
    `).join('');

    zone.innerHTML = `
        <p>
            <strong>${resume.nouveau}</strong> à créer ·
            <strong>${resume.existant}</strong> déjà inscrit(s) ·
            <strong>${resume.doublon}</strong> doublon(s) ·
            <strong style="color:${resume.erreur ? '#c53030' : 'inherit'};">${resume.erreur}</strong> en erreur
        </p>
        <div style="overflow-x:auto;max-height:420px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;">
            <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
                <thead style="position:sticky;top:0;background:#f7fafc;text-align:left;">
                    <tr><th>Ligne</th><th>Statut</th><th>Nom</th><th>Prénom</th><th>Email</th><th>Licence</th><th>Public</th><th>Problème</th></tr>
                </thead>
                <tbody>${lignesHtml}</tbody>
            </table>
        </div>
        <div style="margin-top:1rem;display:flex;flex-direction:column;gap:0.5rem;">
            <label><input type="checkbox" id="import-maj-existants" ${majExistants ? 'checked' : ''}>
                Mettre à jour la licence et le public des comptes existants (${resume.existant})</label>
            <label><input type="checkbox" id="import-envoyer-emails" ${envoyerEmails ? 'checked' : ''}>
                Envoyer aux nouveaux membres l'email pour choisir leur mot de passe</label>
            <div>
                <button type="button" class="btn-success" id="import-valider">Importer</button>
                <button type="button" class="btn-warning" id="import-annuler">Annuler</button>
            </div>
        </div>
    `;

    document.getElementById('import-valider').addEventListener('click', validerImport);
    document.getElementById('import-annuler').addEventListener('click', reinitialiserImport);
}

function reinitialiserImport() {
    importLignesBrutes = null;
    importAnalyse = null;
    importCorrections = {};
    document.getElementById('import-fichier').value = '';
    document.getElementById('import-apercu').innerHTML = '';
}

async function validerImport() {
    const mettreAJourExistants = document.getElementById('import-maj-existants').checked;
    const envoyerEmails = document.getElementById('import-envoyer-emails').checked;
    const aCreer = importAnalyse.filter(l => l.statut === 'nouveau').length;
    const aMettreAJour = mettreAJourExistants ? importAnalyse.filter(l => l.statut === 'existant').length : 0;

    if (aCreer + aMettreAJour === 0) {
        showMessage('Aucun compte à créer ni à mettre à jour', 'error');
        return;
    }

    const resumeAction = [
        aCreer ? `créer ${aCreer} compte(s)` : null,
        aMettreAJour ? `mettre à jour ${aMettreAJour} compte(s)` : null
    ].filter(Boolean).join(' et ');
    const avertissementEmails = envoyerEmails && aCreer ? `\n${aCreer} email(s) de bienvenue seront envoyés.` : '';
    if (!confirm(`Vous allez ${resumeAction}.${avertissementEmails}\n\nContinuer ?`)) return;

    const bouton = document.getElementById('import-valider');
    bouton.disabled = true;
    bouton.textContent = 'Import en cours…';

    try {
        const response = await fetch('/api/admin/users/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lignes: importAnalyse, mettreAJourExistants, envoyerEmails })
        });
        const data = await response.json();

        if (!response.ok) {
            showMessage(data.error, 'error');
            bouton.disabled = false;
            bouton.textContent = 'Importer';
            return;
        }

        const erreursHtml = data.erreurs.length
            ? `<ul style="color:#c53030;">${data.erreurs.map(e =>
                `<li>Ligne ${e.ligne} (${echapperHtml(e.email || 'sans email')}) : ${e.erreurs.map(echapperHtml).join(', ')}</li>`
            ).join('')}</ul>`
            : '';

        document.getElementById('import-fichier').value = '';
        importLignesBrutes = null;
        importAnalyse = null;
        importCorrections = {};
        document.getElementById('import-apercu').innerHTML = `
            <div style="background:#f0fff4;border:1px solid #c6f6d5;color:#276749;border-radius:8px;padding:1rem;">
                ✅ ${data.crees} compte(s) créé(s), ${data.misAJour} mis à jour, ${data.ignores} ignoré(s)${data.erreurs.length ? `, ${data.erreurs.length} en erreur` : ''}.
                ${data.emailsEnvoyes ? `<br>📧 ${data.emailsEnvoyes} email(s) de bienvenue en cours d'envoi.` : ''}
            </div>
            ${erreursHtml}
        `;
        loadAdminUsers();
    } catch (error) {
        showMessage('Erreur de connexion', 'error');
        bouton.disabled = false;
        bouton.textContent = 'Importer';
    }
}

function telechargerModeleImport() {
    // BOM : sans lui, Excel ouvre le fichier en Windows-1252 et abîme les accents
    const contenu = '\uFEFFNom;Prénom;Email;Licence;Public\r\n'
        + 'Dupont;Marie;marie.dupont@example.com;Loisir/Senior;adulte\r\n'
        + 'Martin;Lucas;lucas.martin@example.com;Benjamins/Junior;jeune\r\n';
    const url = URL.createObjectURL(new Blob([contenu], { type: 'text/csv;charset=utf-8' }));
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = 'modele-import-comptes.csv';
    lien.click();
    URL.revokeObjectURL(url);
}

// --- SEMAINES TYPES ET PLANNING ---

let semainesTypes = [];
let semaineTypeCourante = null; // semaine type dont on affiche les créneaux

const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

// « lun. 21/09 »
function formaterJour(dateIso) {
    const date = new Date(`${dateIso}T12:00:00`);
    return `${JOURS_COURTS[date.getDay()]} ${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
}

async function appelApi(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Erreur inattendue');
    return data;
}

function initSemainesTypes() {
    const select = document.getElementById('semaine-type-courante');
    if (!select || select.dataset.pret) return;
    select.dataset.pret = '1';

    select.addEventListener('change', () => {
        semaineTypeCourante = Number(select.value);
        afficherSemaineTypeCourante();
        loadAdminCreneaux();
    });
    document.getElementById('st-nouvelle').addEventListener('click', () => creerSemaineType(false));
    document.getElementById('st-dupliquer').addEventListener('click', () => creerSemaineType(true));
    document.getElementById('st-renommer').addEventListener('click', renommerSemaineType);
    document.getElementById('st-defaut').addEventListener('click', definirSemaineTypeParDefaut);
    document.getElementById('st-supprimer').addEventListener('click', supprimerSemaineType);
}

async function chargerSemainesTypes() {
    try {
        semainesTypes = await appelApi('/api/admin/semaines-types');
    } catch (error) {
        showMessage('Erreur lors du chargement des semaines types', 'error');
        return;
    }

    // Garder la sélection si elle existe encore, sinon la semaine type par défaut
    if (!semainesTypes.some(t => t.id === semaineTypeCourante)) {
        const defaut = semainesTypes.find(t => t.par_defaut) || semainesTypes[0];
        semaineTypeCourante = defaut ? defaut.id : null;
    }

    const select = document.getElementById('semaine-type-courante');
    select.innerHTML = semainesTypes.map(t => `
        <option value="${t.id}" ${t.id === semaineTypeCourante ? 'selected' : ''}>
            ${t.par_defaut ? '★ ' : ''}${echapperHtml(t.nom)} (${t.nb_creneaux} créneau${t.nb_creneaux > 1 ? 'x' : ''})
        </option>
    `).join('');

    afficherSemaineTypeCourante();
    loadAdminCreneaux();
}

function afficherSemaineTypeCourante() {
    const type = semainesTypes.find(t => t.id === semaineTypeCourante);
    document.querySelectorAll('.semaine-type-libelle').forEach(el => {
        el.textContent = type ? `— ${type.nom}` : '';
    });
    const boutonDefaut = document.getElementById('st-defaut');
    boutonDefaut.disabled = !type || type.par_defaut;
    document.getElementById('st-supprimer').disabled = !type || type.par_defaut;
}

async function creerSemaineType(depuisCourante) {
    const source = semainesTypes.find(t => t.id === semaineTypeCourante);
    const nom = prompt(depuisCourante && source
        ? `Nom de la copie de « ${source.nom} » (ses créneaux seront copiés) :`
        : 'Nom de la nouvelle semaine type (ex. : Vacances scolaires) :');
    if (!nom || !nom.trim()) return;

    try {
        const data = await appelApi('/api/admin/semaines-types', {
            method: 'POST',
            body: { nom, source_id: depuisCourante && source ? source.id : undefined }
        });
        showMessage(data.message, 'success');
        semaineTypeCourante = data.semaine_type.id;
        await chargerSemainesTypes();
        chargerPlanning();
    } catch (error) {
        showMessage(error.message, 'error');
    }
}

async function renommerSemaineType() {
    const type = semainesTypes.find(t => t.id === semaineTypeCourante);
    if (!type) return;
    const nom = prompt('Nouveau nom :', type.nom);
    if (!nom || !nom.trim() || nom.trim() === type.nom) return;

    try {
        const data = await appelApi(`/api/admin/semaines-types/${type.id}`, { method: 'PUT', body: { nom } });
        showMessage(data.message, 'success');
        await chargerSemainesTypes();
        chargerPlanning();
    } catch (error) {
        showMessage(error.message, 'error');
    }
}

async function definirSemaineTypeParDefaut() {
    const type = semainesTypes.find(t => t.id === semaineTypeCourante);
    if (!type || type.par_defaut) return;
    if (!confirm(`Faire de « ${type.nom} » la semaine type par défaut ?\n\n`
        + 'Les semaines à venir sans choix explicite la suivront : les séances sans équivalent '
        + 'seront annulées et leurs inscrits prévenus par email.')) return;

    try {
        const data = await appelApi(`/api/admin/semaines-types/${type.id}/defaut`, { method: 'PUT' });
        showMessage(data.message, 'success');
        await chargerSemainesTypes();
        chargerPlanning();
    } catch (error) {
        showMessage(error.message, 'error');
    }
}

async function supprimerSemaineType() {
    const type = semainesTypes.find(t => t.id === semaineTypeCourante);
    if (!type || !confirm(`Supprimer la semaine type « ${type.nom} » ?`)) return;

    try {
        const data = await appelApi(`/api/admin/semaines-types/${type.id}`, { method: 'DELETE' });
        showMessage(data.message, 'success');
        semaineTypeCourante = null;
        await chargerSemainesTypes();
    } catch (error) {
        showMessage(error.message, 'error');
    }
}

async function chargerPlanning() {
    const conteneur = document.getElementById('planning-semaines');
    if (!conteneur) return;

    let semaines;
    try {
        semaines = await appelApi('/api/admin/semaines');
        if (!semainesTypes.length) semainesTypes = await appelApi('/api/admin/semaines-types');
    } catch (error) {
        conteneur.innerHTML = `<p style="color:#c53030;">${echapperHtml(error.message)}</p>`;
        return;
    }

    const libelleOffset = ['Cette semaine', 'Semaine prochaine', 'Dans 2 semaines', 'Dans 3 semaines'];

    conteneur.innerHTML = `
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.95rem;">
                <tbody>
                    ${semaines.map(s => `
                        <tr style="border-top: 1px solid #e2e8f0;">
                            <td style="padding: 0.6rem 0.5rem;">
                                <strong>${libelleOffset[s.offset] || ''}</strong><br>
                                <small style="color: #718096;">${formaterJour(s.lundi)} → ${formaterJour(s.dimanche)}</small>
                            </td>
                            <td style="padding: 0.6rem 0.5rem;">
                                <select data-lundi="${s.lundi}" data-actuel="${s.semaine_type_id}" style="padding: 0.4rem;">
                                    ${semainesTypes.map(t => `
                                        <option value="${t.id}" ${t.id === s.semaine_type_id ? 'selected' : ''}>
                                            ${t.par_defaut ? '★ ' : ''}${echapperHtml(t.nom)}
                                        </option>
                                    `).join('')}
                                </select>
                                ${s.explicite ? '' : '<br><small style="color: #718096;">par défaut</small>'}
                            </td>
                            <td style="padding: 0.6rem 0.5rem; color: #4a5568;">
                                ${s.nb_seances} séance(s) • ${s.nb_inscriptions} inscription(s)
                            </td>
                            <td style="padding: 0.6rem 0.5rem; text-align: right; white-space: nowrap;">
                                <button type="button" class="btn-success" data-appliquer="${s.lundi}" disabled>Appliquer</button>
                                <button type="button" class="btn-warning" data-detail="${s.offset}">📋 Détail</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    conteneur.querySelectorAll('select[data-lundi]').forEach(select => {
        select.addEventListener('change', () => {
            const bouton = conteneur.querySelector(`button[data-appliquer="${select.dataset.lundi}"]`);
            bouton.disabled = select.value === select.dataset.actuel;
        });
    });
    conteneur.querySelectorAll('button[data-detail]').forEach(bouton => {
        bouton.addEventListener('click', () => afficherDetailSemaine(Number(bouton.dataset.detail)));
    });
    conteneur.querySelectorAll('button[data-appliquer]').forEach(bouton => {
        bouton.addEventListener('click', () => {
            const select = conteneur.querySelector(`select[data-lundi="${bouton.dataset.appliquer}"]`);
            appliquerSemaineType(bouton.dataset.appliquer, Number(select.value));
        });
    });
}

// Montre l'impact avant d'appliquer une semaine type à une semaine
async function appliquerSemaineType(lundi, semaineTypeId) {
    const url = `/api/admin/semaines/${lundi}`;
    let bilan;
    try {
        ({ bilan } = await appelApi(url, { method: 'POST', body: { semaine_type_id: semaineTypeId, simulation: true } }));
    } catch (error) {
        showMessage(error.message, 'error');
        return;
    }

    const lignes = [
        `Appliquer « ${bilan.semaine_type.nom} » à la semaine du ${formaterJour(lundi)} ?`,
        '',
        `• ${bilan.conservees} séance(s) conservée(s), avec leurs inscrits`,
        `• ${bilan.creees} séance(s) créée(s)`
    ];
    if (bilan.reactivees > 0) lignes.push(`• ${bilan.reactivees} séance(s) rétablie(s)`);
    if (bilan.annulees.length > 0) {
        lignes.push(`• ${bilan.annulees.length} séance(s) annulée(s) :`);
        for (const s of bilan.annulees) {
            lignes.push(`    – ${s.nom} (${formaterJour(s.date_seance)} ${s.heure_debut}) : ${s.inscrits.length} inscrit(s)`);
        }
        if (bilan.personnes_concernees > 0) {
            lignes.push('', `⚠️ ${bilan.personnes_concernees} personne(s) seront désinscrites et prévenues par email.`);
        }
    }
    lignes.push('', 'Les jours déjà passés ne sont pas modifiés.');

    if (!confirm(lignes.join('\n'))) {
        chargerPlanning(); // remettre la sélection d'origine
        return;
    }

    try {
        const data = await appelApi(url, { method: 'POST', body: { semaine_type_id: semaineTypeId } });
        showMessage(data.message, 'success');
    } catch (error) {
        showMessage(error.message, 'error');
    }
    chargerPlanning();
    loadAdminCreneaux();
    rafraichirDetailSemaine();
}

// --- DÉTAIL D'UNE SEMAINE : AJUSTER SÉANCE PAR SÉANCE ---

let semaineDetaillee = null; // offset de la semaine ouverte, ou null
const LIBELLES_SEMAINES = ['Cette semaine', 'Semaine prochaine', 'Dans 2 semaines', 'Dans 3 semaines'];

function rafraichirDetailSemaine() {
    if (semaineDetaillee !== null) afficherDetailSemaine(semaineDetaillee);
}

async function afficherDetailSemaine(offset) {
    const conteneur = document.getElementById('detail-semaine');
    semaineDetaillee = offset;

    let semaine;
    try {
        semaine = await appelApi(`/api/admin/seances?semaine=${offset}`);
    } catch (error) {
        conteneur.innerHTML = `<p style="color:#c53030;">${echapperHtml(error.message)}</p>`;
        return;
    }

    const aujourdhui = new Date().toLocaleDateString('en-CA');
    const badge = (texte, couleur) =>
        `<span style="background:${couleur};color:white;border-radius:999px;padding:1px 8px;font-size:0.7rem;margin-left:0.25rem;">${texte}</span>`;

    const lignes = semaine.seances.map(s => {
        const passee = s.date_seance < aujourdhui;
        const remplissage = s.sans_limite ? `${s.inscrits} inscrit(s)` : `${s.inscrits}/${s.capacite_max}`;
        const badges = [
            s.sport_nom ? badge(`${s.sport_icone || ''} ${echapperHtml(s.sport_nom)}`, s.sport_couleur || '#28A0E8') : '',
            s.creneau_id ? '' : badge('ponctuelle', '#6b46c1'),
            s.modifiee && s.creneau_id ? badge('ajustée', '#b7791f') : '',
            s.annulee ? badge(s.motif_annulation === 'admin' ? 'annulée' : 'hors semaine type', '#c53030') : ''
        ].join('');

        let actions = '';
        if (!s.annulee) {
            actions += `<button type="button" class="btn-warning" onclick="voirInscriptions(${s.id})">👥 ${s.en_attente ? `${s.inscrits} + ${s.en_attente}` : s.inscrits}</button> `;
        }
        if (!passee && !s.annulee) {
            actions += `<button type="button" class="btn-success" onclick="ouvrirFormulaireSeance(${s.id})">✏️ Modifier</button>
                        <button type="button" class="btn-danger" onclick="annulerSeanceAdmin(${s.id})">❌ Annuler</button>`;
        }
        if (!passee && s.annulee && s.motif_annulation === 'admin') {
            actions += `<button type="button" class="btn-success" onclick="retablirSeanceAdmin(${s.id})">↩️ Rétablir</button>`;
        }

        return `
            <tr style="border-top: 1px solid #e2e8f0; ${s.annulee || passee ? 'opacity: 0.6;' : ''}">
                <td style="padding: 0.5rem; white-space: nowrap;">${formaterJour(s.date_seance)}</td>
                <td style="padding: 0.5rem; white-space: nowrap;">${s.heure_debut} - ${s.heure_fin}</td>
                <td style="padding: 0.5rem;">
                    ${s.annulee ? `<s>${echapperHtml(s.nom)}</s>` : echapperHtml(s.nom)}${badges}
                    ${s.lieu ? `<br><small style="color:#718096;">📍 ${echapperHtml(s.lieu)}</small>` : ''}
                </td>
                <td style="padding: 0.5rem; white-space: nowrap;">${s.annulee ? '—' : remplissage}</td>
                <td style="padding: 0.5rem; text-align: right; white-space: nowrap;">${actions}</td>
            </tr>
        `;
    }).join('');

    conteneur.innerHTML = `
        <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem;">
                <h4 style="margin: 0;">📋 ${LIBELLES_SEMAINES[offset]} — ${formaterJour(semaine.lundi)} → ${formaterJour(semaine.dimanche)}</h4>
                <div>
                    <button type="button" class="btn-success" onclick="ouvrirFormulaireSeance(null)">➕ Séance ponctuelle</button>
                    <button type="button" class="btn-warning" onclick="fermerDetailSemaine()">Fermer</button>
                </div>
            </div>
            ${semaine.seances.length === 0
                ? '<p style="color:#718096;">Aucune séance cette semaine.</p>'
                : `<div style="overflow-x: auto;"><table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;"><tbody>${lignes}</tbody></table></div>`}
        </div>
    `;
    conteneur._semaine = semaine;
}

function fermerDetailSemaine() {
    semaineDetaillee = null;
    document.getElementById('detail-semaine').innerHTML = '';
}

async function annulerSeanceAdmin(seanceId) {
    const seance = document.getElementById('detail-semaine')._semaine.seances.find(s => s.id === seanceId);
    const inscrits = seance.inscrits + seance.en_attente;
    if (!confirm(`Annuler « ${seance.nom} » du ${formaterJour(seance.date_seance)} ?\n\n`
        + (inscrits > 0
            ? `${inscrits} personne(s) seront désinscrites et prévenues par email.\n`
            : 'Personne n\'est inscrit pour l\'instant.\n')
        + 'La séance restera visible, barrée, pour les membres.')) return;

    try {
        const data = await appelApi(`/api/admin/seances/${seanceId}/annulation`, { method: 'POST' });
        showMessage(data.message, 'success');
    } catch (error) {
        showMessage(error.message, 'error');
    }
    rafraichirDetailSemaine();
    chargerPlanning();
}

async function retablirSeanceAdmin(seanceId) {
    try {
        const data = await appelApi(`/api/admin/seances/${seanceId}/annulation`, { method: 'DELETE' });
        showMessage(data.message, 'success');
    } catch (error) {
        showMessage(error.message, 'error');
    }
    rafraichirDetailSemaine();
    chargerPlanning();
}

// Formulaire de modification (seanceId) ou de création d'une séance ponctuelle (null)
async function ouvrirFormulaireSeance(seanceId) {
    const semaine = document.getElementById('detail-semaine')._semaine;
    const seance = seanceId ? semaine.seances.find(s => s.id === seanceId) : null;
    const creation = !seance;

    if (creation && !sports.length) {
        try { sports = await appelApi('/api/sports'); } catch (error) { /* liste vide : le serveur refusera */ }
    }

    // Une séance de créneau ne change de jour que dans sa semaine
    const joursSemaine = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(`${semaine.lundi}T12:00:00`);
        d.setDate(d.getDate() + i);
        return d.toLocaleDateString('en-CA');
    });
    const aujourdhui = new Date().toLocaleDateString('en-CA');
    const valeur = (champ, defaut = '') => echapperHtml(seance && seance[champ] !== null && seance[champ] !== undefined ? seance[champ] : defaut);
    const avecLignes = seance && seance.nombre_lignes;

    const champDate = seance && seance.creneau_id
        ? `<select name="date_seance">${joursSemaine.filter(j => j >= aujourdhui).map(j =>
            `<option value="${j}" ${j === seance.date_seance ? 'selected' : ''}>${formaterJour(j)}</option>`).join('')}</select>`
        : `<input type="date" name="date_seance" required min="${aujourdhui}"
                  value="${seance ? seance.date_seance : joursSemaine.find(j => j >= aujourdhui) || aujourdhui}">`;

    const modal = document.createElement('div');
    modal.className = 'modal modal-seance';
    modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;';
    modal.innerHTML = `
        <form style="background: white; border-radius: 12px; padding: 2rem; max-width: 520px; width: 90%; max-height: 85vh; overflow-y: auto; display: grid; gap: 0.75rem;">
            <h3 style="margin: 0;">${creation ? '➕ Séance ponctuelle' : `✏️ Modifier la séance`}</h3>
            ${seance && seance.creneau_id ? '<p style="margin:0;color:#718096;font-size:0.85rem;">Cette séance ne suivra plus les modifications de son créneau.</p>' : ''}
            <label>Nom <input name="nom" required value="${valeur('nom')}"></label>
            ${creation ? `<label>Sport
                <select name="sport_id" required>
                    <option value="">Choisir…</option>
                    ${sports.map(sp => `<option value="${sp.id}">${sp.icone || ''} ${echapperHtml(sp.nom)}</option>`).join('')}
                </select></label>` : ''}
            <label>Jour ${champDate}</label>
            <div style="display: flex; gap: 0.5rem;">
                <label style="flex:1;">Début <input type="time" name="heure_debut" required value="${valeur('heure_debut')}"></label>
                <label style="flex:1;">Fin <input type="time" name="heure_fin" required value="${valeur('heure_fin')}"></label>
            </div>
            ${avecLignes
                ? `<div style="display: flex; gap: 0.5rem;">
                       <label style="flex:1;">Lignes d'eau <input type="number" min="1" name="nombre_lignes" value="${valeur('nombre_lignes')}"></label>
                       <label style="flex:1;">Personnes / ligne <input type="number" min="1" name="personnes_par_ligne" value="${valeur('personnes_par_ligne')}"></label>
                   </div>`
                : `<label>Capacité <input type="number" min="1" name="capacite_max" value="${valeur('capacite_max')}" placeholder="Défaut du sport"></label>`}
            <label style="display:flex;align-items:center;gap:0.5rem;"><input type="checkbox" name="sans_limite" style="width:auto;" ${seance && seance.sans_limite ? 'checked' : ''}> Sans limite de places</label>
            <label>Lieu <input name="lieu" value="${valeur('lieu')}" list="lieux-connus"></label>
            <label>Public
                <select name="public_cible">
                    ${[['les deux', 'Tous publics'], ['adulte', 'Adultes'], ['jeune', 'Jeunes']].map(([v, l]) =>
                        `<option value="${v}" ${(seance ? seance.public_cible : 'les deux') === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select></label>
            ${seance && (seance.inscrits + seance.en_attente) > 0
                ? `<p style="margin:0;color:#b7791f;font-size:0.85rem;">⚠️ Un changement de jour, d'horaire ou de lieu sera signalé par email aux ${seance.inscrits + seance.en_attente} personne(s) inscrite(s).</p>`
                : ''}
            <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                <button type="button" class="btn-warning" data-fermer>Annuler</button>
                <button type="submit" class="btn-success">${creation ? 'Ajouter' : 'Enregistrer'}</button>
            </div>
        </form>
    `;

    const fermer = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) fermer(); });
    modal.querySelector('[data-fermer]').addEventListener('click', fermer);
    modal.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const donnees = Object.fromEntries(new FormData(e.target).entries());
        donnees.sans_limite = e.target.elements.sans_limite.checked;

        try {
            const data = creation
                ? await appelApi('/api/admin/seances', { method: 'POST', body: donnees })
                : await appelApi(`/api/admin/seances/${seance.id}`, { method: 'PUT', body: donnees });
            showMessage(data.message, 'success');
            fermer();
            rafraichirDetailSemaine();
            chargerPlanning();
        } catch (error) {
            showMessage(error.message, 'error');
        }
    });

    document.body.appendChild(modal);
}