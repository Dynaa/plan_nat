// services/importComptes.js

// Import en masse de comptes à partir d'un export (CSV/Excel) du site de la
// fédération. Le navigateur lit le fichier et envoie ses lignes brutes ; ce
// module les ramène aux champs connus et dit, ligne par ligne, ce que l'import
// en fera. Aucune écriture ici : server.js s'en charge une fois l'aperçu validé.

const LICENCES_VALIDES = ['Compétition', 'Loisir/Senior', 'Benjamins/Junior', 'Poussins/Pupilles'];
const PUBLICS_VALIDES = ['jeune', 'adulte', 'les deux'];
const MAX_LIGNES = 1000;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// « Prénom », « PRENOM », « prénom  » → « prenom »
const normaliserTexte = (valeur) => String(valeur ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Libellés d'en-tête reconnus pour chaque champ. Le format exact de l'export
// de la fédération n'est pas encore connu : la liste reste volontairement large.
const ALIAS_COLONNES = {
    nom: ['nom', 'nom de famille', 'last name', 'lastname'],
    prenom: ['prenom', 'first name', 'firstname'],
    email: ['email', 'e mail', 'mail', 'courriel', 'adresse mail', 'adresse email', 'adresse e mail'],
    licence_type: ['licence', 'type de licence', 'type licence', 'licence type'],
    public_cible: ['public', 'public cible', 'jeune adulte']
};

// Associe chaque en-tête du fichier à un champ connu. Un champ n'est pris
// qu'une fois : la première colonne qui lui correspond l'emporte.
const detecterColonnes = (entetes) => {
    const correspondances = {};
    const pris = new Set();
    for (const entete of entetes) {
        const cle = normaliserTexte(entete);
        const champ = Object.keys(ALIAS_COLONNES).find(c => ALIAS_COLONNES[c].includes(cle));
        if (champ && !pris.has(champ)) {
            correspondances[entete] = champ;
            pris.add(champ);
        }
    }
    return correspondances;
};

// Lignes du fichier ({ en-tête: valeur }) → lignes aux champs connus.
// Les lignes entièrement vides (fréquentes en fin d'export Excel) sont écartées.
const extraireLignes = (objetsBruts) => {
    const entetes = [...new Set(objetsBruts.flatMap(o => Object.keys(o || {})))];
    const colonnes = detecterColonnes(entetes);

    const lignes = [];
    objetsBruts.forEach((objet, index) => {
        const valeurs = Object.values(objet || {}).map(v => String(v ?? '').trim());
        if (valeurs.every(v => v === '')) return;

        const ligne = { ligne: index + 2 }; // +2 : ligne d'en-tête et numérotation à 1
        for (const [entete, champ] of Object.entries(colonnes)) {
            ligne[champ] = String(objet[entete] ?? '').trim();
        }
        lignes.push(ligne);
    });

    return { colonnes, lignes };
};

// null : non renseignée ; undefined : renseignée mais non reconnue
const normaliserLicence = (valeur) => {
    const cle = normaliserTexte(valeur);
    if (!cle) return null;
    return LICENCES_VALIDES.find(l => normaliserTexte(l) === cle)
        || LICENCES_VALIDES.find(l => normaliserTexte(l).split(' ').includes(cle));
};

const normaliserPublic = (valeur) => {
    const cle = normaliserTexte(valeur);
    if (!cle) return null;
    if (['jeune', 'jeunes'].includes(cle)) return 'jeune';
    if (['adulte', 'adultes'].includes(cle)) return 'adulte';
    if (['les deux', 'tous', 'tous publics'].includes(cle)) return 'les deux';
    return undefined;
};

// Statut de chaque ligne : nouveau, existant (compte déjà en base), doublon
// (email déjà vu plus haut dans le fichier) ou erreur.
// `emailsExistants` : emails en minuscules des comptes déjà en base.
// `defauts` : licence et public appliqués quand la ligne n'en précise pas.
const analyserLignes = (lignes, emailsExistants, defauts = {}) => {
    const existants = new Set(emailsExistants);
    const vus = new Set();

    return lignes.map((brute, index) => {
        const erreurs = [];
        const nom = String(brute.nom ?? '').trim();
        const prenom = String(brute.prenom ?? '').trim();
        const email = String(brute.email ?? '').trim().toLowerCase();

        if (!nom) erreurs.push('Nom manquant');
        if (!prenom) erreurs.push('Prénom manquant');
        if (!email) erreurs.push('Email manquant');
        else if (!EMAIL_REGEX.test(email)) erreurs.push('Email invalide');

        let licence = normaliserLicence(brute.licence_type);
        if (licence === undefined) {
            erreurs.push(`Licence inconnue : « ${brute.licence_type} »`);
        } else if (licence === null) {
            licence = LICENCES_VALIDES.includes(defauts.licence_type) ? defauts.licence_type : null;
            if (!licence) erreurs.push('Licence à renseigner');
        }

        let publicCible = normaliserPublic(brute.public_cible);
        if (publicCible === undefined) {
            erreurs.push(`Public inconnu : « ${brute.public_cible} »`);
        } else if (publicCible === null) {
            publicCible = PUBLICS_VALIDES.includes(defauts.public_cible) ? defauts.public_cible : 'adulte';
        }

        let statut;
        if (erreurs.length > 0) statut = 'erreur';
        else if (vus.has(email)) statut = 'doublon';
        else if (existants.has(email)) statut = 'existant';
        else statut = 'nouveau';

        if (email) vus.add(email);

        return {
            ligne: brute.ligne ?? index + 1,
            nom,
            prenom,
            email,
            licence_type: licence || null,
            public_cible: publicCible || null,
            statut,
            erreurs
        };
    });
};

const resumer = (analyse) => analyse.reduce((acc, l) => {
    acc[l.statut] += 1;
    return acc;
}, { nouveau: 0, existant: 0, doublon: 0, erreur: 0 });

module.exports = {
    LICENCES_VALIDES,
    PUBLICS_VALIDES,
    MAX_LIGNES,
    detecterColonnes,
    extraireLignes,
    normaliserLicence,
    normaliserPublic,
    analyserLignes,
    resumer
};
