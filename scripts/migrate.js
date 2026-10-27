import { loadConfig } from "../src/config.js";
import { connectDatabase, migrate } from "../src/db.js";
const db = await connectDatabase(loadConfig());
try {
  await migrate(db);
  console.log("Database migrations applied.");
} finally {
  await db.close();
}
