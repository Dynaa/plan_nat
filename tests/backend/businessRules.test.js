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
        // Séance du jeudi 17 septembre 2026, en natation
        const seanceJeudi = { id: 10, creneau_id: 3, sport_id: 1, date_seance: '2026-09-17' };

        it("devrait autoriser l'inscription si les meta-règles sont désactivées", async () => {
            mockDb.get.mockResolvedValueOnce({ enabled: false });

            const result = await verifierMetaRegles(mockDb, 1, seanceJeudi);

            expect(result.autorise).toBe(true);
            expect(mockDb.get).toHaveBeenCalledTimes(1);
        });

        it("devrait interdire une inscription listée dans les jours interdits d'une meta-règle (format string csv)", async () => {
            mockDb.get
                .mockResolvedValueOnce({ enabled: true })
                .mockResolvedValueOnce({ licence_type: 'Natation adulte' })
                .mockResolvedValueOnce({ id: 99 }); // inscrit le mardi de la même semaine
            mockDb.query.mockResolvedValueOnce([{
                jour_source: 2, // Inscrit le Mardi
                jours_interdits: '4,6', // Interdit le Jeudi et Samedi
                description: 'Interdit car deja inscrit mardi'
            }]);

            const result = await verifierMetaRegles(mockDb, 1, seanceJeudi);

            expect(result.autorise).toBe(false);
            expect(result.message).toContain('Inscription interdite : vous êtes déjà inscrit');
            // Les règles sont celles du sport de la séance
            expect(mockDb.query.mock.calls[0][1]).toEqual(['Natation adulte', 1]);
            // L'inscription déclenchante est cherchée le mardi de la même semaine, même sport
            expect(mockDb.get.mock.calls[2][1]).toEqual([1, '2026-09-15', 1]);
        });

        it("devrait autoriser si la séance n'est pas dans les jours interdits d'une meta-règle (format JSON)", async () => {
            mockDb.get
                .mockResolvedValueOnce({ enabled: true })
                .mockResolvedValueOnce({ licence_type: 'Natation adulte' });
            mockDb.query.mockResolvedValueOnce([{
                jour_source: 2,
                jours_interdits: '[4,6]',
                description: 'Interdit car deja inscrit mardi'
            }]);

            // Vendredi 18 septembre
            const result = await verifierMetaRegles(mockDb, 1, { ...seanceJeudi, date_seance: '2026-09-18' });

            expect(result.autorise).toBe(true);
            // Jour non concerné : aucune recherche d'inscription déclenchante
            expect(mockDb.get).toHaveBeenCalledTimes(2);
        });

        it("devrait autoriser si l'utilisateur n'est pas inscrit au jour source", async () => {
            mockDb.get
                .mockResolvedValueOnce({ enabled: true })
                .mockResolvedValueOnce({ licence_type: 'Natation adulte' })
                .mockResolvedValueOnce(null); // pas inscrit le mardi
            mockDb.query.mockResolvedValueOnce([{
                jour_source: 2,
                jours_interdits: '[4,6]'
            }]);

            const result = await verifierMetaRegles(mockDb, 1, seanceJeudi);

            expect(result.autorise).toBe(true);
        });
    });
});