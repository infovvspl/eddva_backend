const { Client } = require('pg'); 
const c = new Client({ connectionString: 'postgresql://postgres:eddva-dev@eddva-dev.cpo2kqqgu55d.ap-south-1.rds.amazonaws.com:5432/eddva_school', ssl: { rejectUnauthorized: false } }); 
c.connect().then(async () => {
    try {
        console.log("Adding profile_image column...");
        await c.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT;`);
        console.log("Migrating photo to profile_image...");
        await c.query(`UPDATE users SET profile_image = photo WHERE photo IS NOT NULL AND profile_image IS NULL;`);
        console.log("Success.");
    } catch (err) {
        console.error("Error:", err);
    } finally {
        c.end();
    }
});
