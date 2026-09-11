// État de l'application
let currentUser = null;
let creneaux = [];
let sports = [];
let sportFiltreActif = 'tous'; // slug du sport affiché, ou 'tous'

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
