const {
    verifierLimitesSeances,
    sportDuCreneau,
    bornesSemaine
} = require('../../services/businessRules');

describe('Quota hebdomadaire par sport (phase 1)', () => {
    let mockDb;

    beforeEach(() => {
        mockDb = {
            isPostgres: true,
            get: jest.fn(),
            query: jest.fn(),
            run: jest.fn(),
            adaptSQL: jest.fn((sqlite, postgres) => postgres === undefined ? sqlite : postgres)
        };
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('bornesSemaine', () => {

        it('devrait encadrer une date du lundi au dimanche', () => {
            // 2026-09-09 est un mercredi
            const { debut, fin } = bornesSemaine('2026-09-09');

            expect(debut).toBe('2026-09-07'); // lundi
            expect(fin).toBe('2026-09-13');   // dimanche
        });

        it('devrait rattacher un dimanche à la semaine qui se termine, pas à la suivante', () => {
            const { debut, fin } = bornesSemaine('2026-09-13'); // dimanche

            expect(debut).toBe('2026-09-07');
            expect(fin).toBe('2026-09-13');
        });

        it('devrait garder un lundi comme premier jour de sa semaine', () => {
            const { debut, fin } = bornesSemaine('2026-09-07'); // lundi

            expect(debut).toBe('2026-09-07');
            expect(fin).toBe('2026-09-13');
        });

        it('devrait séparer deux semaines consécutives', () => {
            const semaine1 = bornesSemaine('2026-09-09');
            const semaine2 = bornesSemaine('2026-09-16');

            expect(semaine1.debut).not.toBe(semaine2.debut);
            expect(semaine2.debut).toBe('2026-09-14');
        });
    });

    describe('verifierLimitesSeances', () => {

        it('devrait ne compter que les séances de la semaine visée et du sport concerné', async () => {
            mockDb.get
                .mockResolvedValueOnce({ licence_type: 'Loisir/Senior' })
                .mockResolvedValueOnce({ max_seances_semaine: 3 })
                .mockResolvedValueOnce({ seances: 1 });

            const result = await verifierLimitesSeances(mockDb, 7, 1, '2026-09-09');

            // Le quota est cherché pour le couple (licence, sport)
            const [sqlQuota, paramsQuota] = mockDb.get.mock.calls[1];
            expect(sqlQuota).toContain('licence_limits');
            expect(paramsQuota).toEqual(['Loisir/Senior', 1]);

            // Le décompte borne la semaine et filtre sur le sport
            const [sqlCompte, paramsCompte] = mockDb.get.mock.calls[2];
            expect(sqlCompte).toContain('date_seance BETWEEN');
            expect(sqlCompte).toContain('s.sport_id');
            expect(paramsCompte).toEqual([7, '2026-09-07', '2026-09-13', 1]);

            expect(result.seancesActuelles).toBe(1);
            expect(result.seancesRestantes).toBe(2);
            expect(result.limiteAtteinte).toBe(false);
        });

        it('devrait signaler la limite atteinte au maximum', async () => {
            mockDb.get
                .mockResolvedValueOnce({ licence_type: 'Loisir/Senior' })
                .mockResolvedValueOnce({ max_seances_semaine: 3 })
                .mockResolvedValueOnce({ seances: 3 });

            const result = await verifierLimitesSeances(mockDb, 7, 1, '2026-09-09');

            expect(result.limiteAtteinte).toBe(true);
            expect(result.seancesRestantes).toBe(0);
        });

        it('devrait laisser libre un sport sans quota configuré', async () => {
            mockDb.get
                .mockResolvedValueOnce({ licence_type: 'Loisir/Senior' })
                .mockResolvedValueOnce(null);

            const result = await verifierLimitesSeances(mockDb, 7, 2, '2026-09-09');

            expect(result.limiteApplicable).toBe(false);
            // Le décompte des séances n'a même pas lieu
            expect(mockDb.get).toHaveBeenCalledTimes(2);
        });
    });

    describe('périmètre piloté par la configuration', () => {

        // Le cœur de la phase 3 : ajouter ou retirer un quota est une opération
        // de configuration, plus une modification de code.
        it('devrait appliquer un quota à n\'importe quel sport dès qu\'il est configuré', async () => {
            for (const sportId of [1, 2, 3, 4]) {
                mockDb.get
                    .mockResolvedValueOnce({ licence_type: 'Loisir/Senior' })
                    .mockResolvedValueOnce({ max_seances_semaine: 2 })
                    .mockResolvedValueOnce({ seances: 2 });

                const result = await verifierLimitesSeances(mockDb, 7, sportId, '2026-09-09');

                expect(result.limiteApplicable).toBe(true);
                expect(result.limiteAtteinte).toBe(true);
                jest.clearAllMocks();
            }
        });

        it('devrait laisser libre n\'importe quel sport sans configuration', async () => {
            for (const sportId of [1, 2, 3, 4]) {
                mockDb.get
                    .mockResolvedValueOnce({ licence_type: 'Loisir/Senior' })
                    .mockResolvedValueOnce(null);

                const result = await verifierLimitesSeances(mockDb, 7, sportId, '2026-09-09');

                expect(result.limiteApplicable).toBe(false);
                jest.clearAllMocks();
            }
        });
    });

    describe('sportDuCreneau', () => {

        it('devrait renvoyer le sport du créneau', async () => {
            mockDb.get.mockResolvedValueOnce({ sport_id: 3 });

            await expect(sportDuCreneau(mockDb, 1)).resolves.toBe(3);
        });

        it('devrait renvoyer null pour un créneau inexistant', async () => {
            mockDb.get.mockResolvedValueOnce(null);

            await expect(sportDuCreneau(mockDb, 99)).resolves.toBeNull();
        });
    });
});
