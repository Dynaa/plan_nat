require('dotenv').config();
const DatabaseAdapter = require('./database');
const { verifierLimitesSeances } = require('./services/businessRules');

async function test() {
    const db = new DatabaseAdapter();
    console.log("DB Postgres?", db.isPostgres);
    console.log("URL:", process.env.DATABASE_URL);

    try {
        // Find any user id
        const userResult = await db.query("SELECT id FROM users LIMIT 1");
        if (userResult.length === 0) {
            console.log("No users in DB");
            process.exit(0);
        }

        const userId = userResult[0].id;
        console.log("Testing verifierLimitesSeances for user ID:", userId);

        const result = await verifierLimitesSeances(db, userId);
        console.log("Result:", result);
    } catch (err) {
        console.error("FATAL ERROR IN verifierLimitesSeances:", err);
    }

    process.exit(0);
}

test();
