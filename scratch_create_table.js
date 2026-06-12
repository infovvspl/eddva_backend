const { Client } = require('pg');

async function run() {
  const clientSchool = new Client({
    connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await clientSchool.connect();
    
    // Create the memory_match_leaderboard table
    await clientSchool.query(`
      CREATE TABLE IF NOT EXISTS "memory_match_leaderboard" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "user_id" uuid NOT NULL,
        "xp" integer NOT NULL DEFAULT 0,
        "deck_name" character varying,
        "turns" integer NOT NULL DEFAULT 0,
        "misses" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_memory_match_leaderboard" PRIMARY KEY ("id"),
        CONSTRAINT "FK_memory_match_leaderboard_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      );
    `);
    
    console.log("Table memory_match_leaderboard created in eddva_school DB successfully.");

    await clientSchool.end();
  } catch (e) {
    console.error("Error creating table:", e);
  }
}

run();
