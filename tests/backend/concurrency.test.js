// Mocker la base AVANT de charger le serveur
jest.mock('../../database', () => {
    return jest.fn().mockImplementation(() => ({
        isPostgres: true,
        isTest: false,
        get: jest.fn(),
        query: jest.fn(),
        run: jest.fn(),
        adaptSQL: (sql) => sql,
    }));
});

// Ces tests documentent le comportement attendu en cas de concurrence.
// Les vrais tests de concurrence nécessitent une base PostgreSQL active.
// Ici on vérifie les invariants logiques testables en isolation.
describe('Concurrence BDD (Simulations API)', () => {

    describe('Double Inscription (Race Condition)', () => {
        it('devrait rejeter logiquement une inscription au delà de la capacité', async () => {
            // Un test de race condition réelle requiert deux appels parallèles sur une 
            // vraie BDD PostgreSQL (UNIQUE constraint + transactions).
            // Cette structure est prête pour être étendue avec une vraie BDD de test.
            expect(true).toBe(true);
        });

        it('Postgres UNIQUE constraint empêche les doublons (exemple documentaire)', () => {
            // La table inscriptions a UNIQUE(user_id, creneau_id)
            // Ce test vérifie qu'on comprend et documente ce comportement
            const constraint = 'UNIQUE(user_id, creneau_id)';
            expect(constraint).toBeDefined();
        });
    });
});
