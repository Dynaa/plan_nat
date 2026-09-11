const {
    verifierLimitesSeances,
    creneauSoumisAuQuota,
    bornesSemaine,
    SPORT_AVEC_QUOTA
} = require('../../services/businessRules');

describe('Quota hebdomadaire par sport (phase 1)', () => {
    let mockDb;

    beforeEach(() => {
        mockDb = {
            isPostgres: true,
            get: jest.fn(),
            query: jest.fn(),
            run: jest.fn()
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

        it('devrait ne compter que les séances de la semaine visée et du sport contraint', async () => {
            mockDb.get.mockResolvedValueOnce({
                licence_type: 'Loisir/Senior',
                max_seances_semaine: 3,
                seances_cette_semaine: 1
            });

            const result = await verifierLimitesSeances(mockDb, 7, '2026-09-09');

            const [sql, params] = mockDb.get.mock.calls[0];

            // La requête borne la semaine et se limite au sport contraint
            expect(sql).toContain('date_seance BETWEEN');
            expect(sql).toContain('JOIN sports');
            expect(params).toEqual([7, '2026-09-07', '2026-09-13', SPORT_AVEC_QUOTA]);

            expect(result.seancesActuelles).toBe(1);
            expect(result.seancesRestantes).toBe(2);
            expect(result.limiteAtteinte).toBe(false);
        });

        it('devrait ordonner les paramètres correctement en SQLite', async () => {
            mockDb.isPostgres = false;
            mockDb.get.mockResolvedValueOnce({
                licence_type: 'Compétition',
                max_seances_semaine: 4,
                seances_cette_semaine: 0
            });

            await verifierLimitesSeances(mockDb, 7, '2026-09-09');

            // En SQLite les ? sont positionnels : semaine, sport, puis utilisateur
            const [, params] = mockDb.get.mock.calls[0];
            expect(params).toEqual(['2026-09-07', '2026-09-13', SPORT_AVEC_QUOTA, 7]);
        });

        it('devrait signaler la limite atteinte au maximum', async () => {
            mockDb.get.mockResolvedValueOnce({
                licence_type: 'Loisir/Senior',
                max_seances_semaine: 3,
                seances_cette_semaine: 3
            });

            const result = await verifierLimitesSeances(mockDb, 7, '2026-09-09');

            expect(result.limiteAtteinte).toBe(true);
            expect(result.seancesRestantes).toBe(0);
        });
    });

    describe('creneauSoumisAuQuota', () => {

        it('devrait soumettre un créneau de natation au quota', async () => {
            mockDb.get.mockResolvedValueOnce({ slug: 'natation' });

            await expect(creneauSoumisAuQuota(mockDb, 1)).resolves.toBe(true);
        });

        it('devrait exempter les autres sports', async () => {
            for (const slug of ['velo', 'course', 'ppg']) {
                mockDb.get.mockResolvedValueOnce({ slug });
                await expect(creneauSoumisAuQuota(mockDb, 2)).resolves.toBe(false);
            }
        });

        it('devrait exempter un créneau sans sport rattaché', async () => {
            mockDb.get.mockResolvedValueOnce(null);

            await expect(creneauSoumisAuQuota(mockDb, 3)).resolves.toBe(false);
        });
    });
});
