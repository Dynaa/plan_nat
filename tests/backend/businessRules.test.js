const { verifierLimitesSeances, verifierMetaRegles } = require('../../services/businessRules');

describe('Business Rules Logic', () => {
    let mockDb;

    beforeEach(() => {
        // Mock simple de la base de données
        mockDb = {
            isPostgres: true,
            get: jest.fn(),
            query: jest.fn(),
            run: jest.fn(),
            adaptSQL: jest.fn((sqlite, postgres) => postgres === undefined ? sqlite : postgres)
        };

        // Fix de date pour consistance des tests (MockDate pourrait être utile mais essayons avec mock natif si besoin,
        // on ne teste pas les dates de la requete SQL mais plutot la logique d'interdiction/limite)
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('verifierLimitesSeances', () => {
        it('devrait retourner limite non atteinte si moins de séances que le max prescrit', async () => {
            mockDb.get
                .mockResolvedValueOnce({ licence_type: 'Triathlon compétition' }) // utilisateur
                .mockResolvedValueOnce({ max_seances_semaine: 4 })                // quota du sport
                .mockResolvedValueOnce({ seances: 2 });                           // séances de la semaine

            const result = await verifierLimitesSeances(mockDb, 1, 1);

            expect(result.limiteApplicable).toBe(true);
            expect(result.limiteAtteinte).toBe(false);
            expect(result.seancesRestantes).toBe(2);
        });

        it('devrait retourner limite atteinte si séances >= max prescrit', async () => {
            mockDb.get
                .mockResolvedValueOnce({ licence_type: 'Triathlon loisir' })
                .mockResolvedValueOnce({ max_seances_semaine: 3 })
                .mockResolvedValueOnce({ seances: 3 });

            const result = await verifierLimitesSeances(mockDb, 2, 1);

            expect(result.limiteAtteinte).toBe(true);
            expect(result.seancesRestantes).toBe(0);
        });

        it('ne devrait imposer aucune limite si le sport n\'a pas de quota configuré', async () => {
            mockDb.get
                .mockResolvedValueOnce({ licence_type: 'Triathlon loisir' })
                .mockResolvedValueOnce(null); // aucune ligne dans licence_limits

            const result = await verifierLimitesSeances(mockDb, 3, 2);

            expect(result.limiteApplicable).toBe(false);
            expect(result.limiteAtteinte).toBeUndefined();
        });

        it('ne devrait imposer aucune limite à un créneau sans sport', async () => {
            mockDb.get.mockResolvedValueOnce({ licence_type: 'Triathlon loisir' });

            const result = await verifierLimitesSeances(mockDb, 3, null);

            expect(result.limiteApplicable).toBe(false);
        });
    });

    describe('verifierMetaRegles', () => {
        it('devrait autoriser l\'inscription si les meta-règles sont désactivées', async () => {
            mockDb.get.mockResolvedValueOnce({ enabled: false });

            const result = await verifierMetaRegles(mockDb, 1, 10);

            expect(result.autorise).toBe(true);
            expect(mockDb.get).toHaveBeenCalledTimes(1);
        });

        it('devrait interdire une inscription listée dans les jours interdits d\'une meta-règle (format string csv)', async () => {
            // Configuration Meta-règles activées
            mockDb.get.mockResolvedValueOnce({ enabled: true });
            // User Infos
            mockDb.get.mockResolvedValueOnce({ licence_type: 'Natation adulte' });
            // Creneau Infos (Ex: Jeudi = 4)
            mockDb.get.mockResolvedValueOnce({ jour_semaine: 4 });
            // Meta-règles pour ce type
            mockDb.query.mockResolvedValueOnce([{
                jour_source: 2, // Inscrit le Mardi
                jours_interdits: "4,6", // Interdit le Jeudi et Samedi
                description: "Interdit car deja inscrit mardi"
            }]);
            // Verification si inscrit au jour source
            mockDb.get.mockResolvedValueOnce({ id: 99 }); // Oui, il est inscrit le mardi

            const result = await verifierMetaRegles(mockDb, 1, 10);

            expect(result.autorise).toBe(false);
            expect(result.message).toContain('Inscription interdite : vous êtes déjà inscrit');
        });

        it('devrait autoriser si le créneau n\'est pas dans les jours interdits d\'une meta-règle (format JSON)', async () => {
            // Configuration Meta-règles activées
            mockDb.get.mockResolvedValueOnce({ enabled: true });
            // User Infos
            mockDb.get.mockResolvedValueOnce({ licence_type: 'Natation adulte' });
            // Creneau Infos (Ex: Vendredi = 5)
            mockDb.get.mockResolvedValueOnce({ jour_semaine: 5 });
            // Meta-règles pour ce type
            mockDb.query.mockResolvedValueOnce([{
                jour_source: 2, // Inscrit le Mardi
                jours_interdits: "[4,6]", // Interdit le Jeudi et Samedi
                description: "Interdit car deja inscrit mardi"
            }]);
            // Verification si inscrit au jour source
            mockDb.get.mockResolvedValueOnce({ id: 99 }); // Oui, il est inscrit le mardi

            const result = await verifierMetaRegles(mockDb, 1, 10);

            expect(result.autorise).toBe(true);
        });

        it('devrait autoriser si l\'utilisateur n\'est pas inscrit au jour source', async () => {
            // Configuration Meta-règles activées
            mockDb.get.mockResolvedValueOnce({ enabled: true });
            // User Infos
            mockDb.get.mockResolvedValueOnce({ licence_type: 'Natation adulte' });
            // Creneau Infos (Ex: Jeudi = 4)
            mockDb.get.mockResolvedValueOnce({ jour_semaine: 4 });
            // Meta-règles pour ce type
            mockDb.query.mockResolvedValueOnce([{
                jour_source: 2, // Inscrit le Mardi
                jours_interdits: "[4,6]", // Interdit le Jeudi et Samedi
            }]);
            // Verification si inscrit au jour source
            mockDb.get.mockResolvedValueOnce(null); // Non, pas inscrit le mardi

            const result = await verifierMetaRegles(mockDb, 1, 10);

            expect(result.autorise).toBe(true);
        });
    });
});
