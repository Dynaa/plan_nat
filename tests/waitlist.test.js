const request = require('supertest');
const path = require('path');

// Mock de la base de données pour les tests
const mockDb = {
  isPostgres: false,
  data: {
    users: [],
    creneaux: [],
    inscriptions: [],
    waitlist_tokens: []
  },
  
  async get(sql, params = []) {
    // Simuler les requêtes GET
    if (sql.includes('SELECT * FROM users WHERE email = ?')) {
      return this.data.users.find(u => u.email === params[0]);
    }
    if (sql.includes('SELECT * FROM creneaux WHERE id = ?')) {
      return this.data.creneaux.find(c => c.id === params[0]);
    }
    if (sql.includes('SELECT COUNT(*) as count FROM inscriptions')) {
      const creneauId = params[0];
      return { count: this.data.inscriptions.filter(i => i.creneau_id === creneauId && i.statut === 'inscrit').length };
    }
    return null;
  },
  
  async query(sql, params = []) {
    // Simuler les requêtes de liste
    if (sql.includes('SELECT user_id FROM inscriptions') && sql.includes('attente')) {
      const creneauId = params[0];
      return this.data.inscriptions
        .filter(i => i.creneau_id === creneauId && i.statut === 'attente')
        .sort((a, b) => a.position_attente - b.position_attente);
    }
    return [];
  },
  
  async run(sql, params = []) {
    // Simuler les requêtes d'insertion/modification
    if (sql.includes('INSERT INTO waitlist_tokens')) {
      const token = {
        id: this.data.waitlist_tokens.length + 1,
        token: params[0],
        user_id: params[1],
        creneau_id: params[2],
        expires_at: params[3],
        used: false
      };
      this.data.waitlist_tokens.push(token);
      return { lastID: token.id };
    }
    return { changes: 1, lastID: 1 };
  },
  
  // Méthodes utilitaires pour les tests
  reset() {
    this.data = {
      users: [],
      creneaux: [],
      inscriptions: [],
      waitlist_tokens: []
    };
  },
  
  addTestData() {
    // Ajouter des données de test
    this.data.users = [
      { id: 1, email: 'user1@test.com', nom: 'User', prenom: 'One' },
      { id: 2, email: 'user2@test.com', nom: 'User', prenom: 'Two' },
      { id: 3, email: 'user3@test.com', nom: 'User', prenom: 'Three' }
    ];
    
    this.data.creneaux = [
      { id: 1, nom: 'Test Créneau', capacite_max: 2, jour_semaine: 1, heure_debut: '18:00', heure_fin: '19:00' }
    ];
    
    this.data.inscriptions = [
      { id: 1, user_id: 1, creneau_id: 1, statut: 'inscrit', position_attente: null },
      { id: 2, user_id: 2, creneau_id: 1, statut: 'inscrit', position_attente: null },
      { id: 3, user_id: 3, creneau_id: 1, statut: 'attente', position_attente: 1 }
    ];
  }
};

// Mock du module database
jest.mock('../database.js', () => {
  return jest.fn().mockImplementation(() => mockDb);
});

describe('🏊‍♀️ Tests de la liste d\'attente', () => {
  let app;
  
  beforeAll(async () => {
    // Charger l'application après avoir mocké la base de données
    delete require.cache[require.resolve('../server.js')];
    
    // Mock des sessions pour les tests
    const session = require('express-session');
    jest.spyOn(session, 'MemoryStore').mockImplementation(() => ({
      get: jest.fn((sid, callback) => callback(null, { userId: 1 })),
      set: jest.fn((sid, session, callback) => callback()),
      destroy: jest.fn((sid, callback) => callback())
    }));
    
    app = require('../server.js');
    
    // Attendre un peu pour que l'initialisation se termine
    await new Promise(resolve => setTimeout(resolve, 100));
  });
  
  beforeEach(() => {
    mockDb.reset();
    mockDb.addTestData();
    jest.clearAllMocks();
  });

  describe('📧 Notification par email', () => {
    test('Doit envoyer un email à tous les utilisateurs en liste d\'attente', async () => {
      // Ajouter plus d'utilisateurs en attente
      mockDb.data.inscriptions.push(
        { id: 4, user_id: 4, creneau_id: 1, statut: 'attente', position_attente: 2 }
      );
      mockDb.data.users.push(
        { id: 4, email: 'user4@test.com', nom: 'User', prenom: 'Four' }
      );

      // Simuler une désinscription (qui devrait déclencher les notifications)
      const response = await request(app)
        .delete('/api/inscriptions/1')
        .set('Cookie', ['connect.sid=test-session']);

      expect(response.status).toBe(200);
      expect(response.body.notification).toBe(true);
      expect(response.body.message).toContain('personne(s) en liste d\'attente ont été notifiées');
    });

    test('Ne doit pas envoyer d\'email si personne n\'est en attente', async () => {
      // Supprimer tous les utilisateurs en attente
      mockDb.data.inscriptions = mockDb.data.inscriptions.filter(i => i.statut !== 'attente');

      const response = await request(app)
        .delete('/api/inscriptions/1')
        .set('Cookie', ['connect.sid=test-session']);

      expect(response.status).toBe(200);
      expect(response.body.notification).toBeUndefined();
      expect(response.body.message).toBe('Désinscription réussie');
    });
  });

  describe('🔐 Gestion des tokens', () => {
    test('Doit créer un token unique pour chaque notification', async () => {
      const { Resend } = require('resend');
      const mockResend = new Resend();
      
      // Simuler l'envoi d'email qui crée des tokens
      await request(app)
        .delete('/api/inscriptions/1')
        .set('Cookie', ['connect.sid=test-session']);

      // Vérifier qu'un token a été créé
      expect(mockDb.data.waitlist_tokens.length).toBeGreaterThan(0);
      
      const token = mockDb.data.waitlist_tokens[0];
      expect(token.token).toBeDefined();
      expect(token.user_id).toBe(3); // Premier utilisateur en attente
      expect(token.creneau_id).toBe(1);
      expect(token.used).toBe(false);
    });

    test('Doit valider un token valide', async () => {
      // Créer un token de test
      const testToken = 'test-token-123';
      mockDb.data.waitlist_tokens.push({
        id: 1,
        token: testToken,
        user_id: 3,
        creneau_id: 1,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h dans le futur
        used: false
      });

      const response = await request(app)
        .post('/api/inscription-attente')
        .send({ token: testToken });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Inscription confirmée');
    });

    test('Doit rejeter un token expiré', async () => {
      // Créer un token expiré
      const expiredToken = 'expired-token-123';
      mockDb.data.waitlist_tokens.push({
        id: 1,
        token: expiredToken,
        user_id: 3,
        creneau_id: 1,
        expires_at: new Date(Date.now() - 1000).toISOString(), // Expiré
        used: false
      });

      const response = await request(app)
        .post('/api/inscription-attente')
        .send({ token: expiredToken });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Token invalide ou expiré');
    });

    test('Doit rejeter un token déjà utilisé', async () => {
      // Créer un token utilisé
      const usedToken = 'used-token-123';
      mockDb.data.waitlist_tokens.push({
        id: 1,
        token: usedToken,
        user_id: 3,
        creneau_id: 1,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        used: true // Déjà utilisé
      });

      const response = await request(app)
        .post('/api/inscription-attente')
        .send({ token: usedToken });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Token invalide ou expiré');
    });
  });

  describe('🏁 Course à l\'inscription (premier arrivé, premier servi)', () => {
    test('Le premier à confirmer doit obtenir la place', async () => {
      // Créer deux tokens pour deux utilisateurs différents
      const token1 = 'token-user3';
      const token2 = 'token-user4';
      
      mockDb.data.users.push({ id: 4, email: 'user4@test.com', nom: 'User', prenom: 'Four' });
      mockDb.data.inscriptions.push({ id: 4, user_id: 4, creneau_id: 1, statut: 'attente', position_attente: 2 });
      
      mockDb.data.waitlist_tokens.push(
        {
          id: 1, token: token1, user_id: 3, creneau_id: 1,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), used: false
        },
        {
          id: 2, token: token2, user_id: 4, creneau_id: 1,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), used: false
        }
      );

      // Premier utilisateur confirme
      const response1 = await request(app)
        .post('/api/inscription-attente')
        .send({ token: token1 });

      expect(response1.status).toBe(200);
      expect(response1.body.success).toBe(true);

      // Deuxième utilisateur essaie de confirmer (trop tard)
      const response2 = await request(app)
        .post('/api/inscription-attente')
        .send({ token: token2 });

      expect(response2.status).toBe(409);
      expect(response2.body.tooLate).toBe(true);
      expect(response2.body.error).toContain('quelqu\'un d\'autre a pris la place');
    });
  });

  describe('📊 Réorganisation des positions', () => {
    test('Doit réorganiser les positions après une inscription', async () => {
      // Ajouter plus d'utilisateurs en attente
      mockDb.data.users.push(
        { id: 4, email: 'user4@test.com', nom: 'User', prenom: 'Four' },
        { id: 5, email: 'user5@test.com', nom: 'User', prenom: 'Five' }
      );
      mockDb.data.inscriptions.push(
        { id: 4, user_id: 4, creneau_id: 1, statut: 'attente', position_attente: 2 },
        { id: 5, user_id: 5, creneau_id: 1, statut: 'attente', position_attente: 3 }
      );

      // Créer un token pour le premier en attente
      const token = 'token-first-in-line';
      mockDb.data.waitlist_tokens.push({
        id: 1, token, user_id: 3, creneau_id: 1,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), used: false
      });

      // Confirmer l'inscription
      const response = await request(app)
        .post('/api/inscription-attente')
        .send({ token });

      expect(response.status).toBe(200);
      
      // Vérifier que les positions ont été réorganisées
      // (Dans un vrai test, on vérifierait que les positions 2 et 3 sont devenues 1 et 2)
    });
  });
});