import { DataSource } from "typeorm";
import { coachingDbConfig } from "../src/config/database.config";

async function run() {
  const ds = new DataSource({
    ...coachingDbConfig,
    synchronize: false,
    logging: false,
  });
  await ds.initialize();
  const rows = await ds.query(`SELECT maintenance_mode, platform_name FROM platform_config`);
  console.log("Platform Config:", rows);
  await ds.destroy();
}

run().catch(console.error);
