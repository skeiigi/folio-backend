import { loadConfig } from '../src/config.js';
import { connectDatabase,migrate } from '../src/db.js';
import { seedDatabase } from '../src/seed.js';
const config=loadConfig();
if(config.production && !process.env.DEMO_PASSWORD)throw new Error('Set DEMO_PASSWORD explicitly before seeding a hosted demo.');
const password=process.env.DEMO_PASSWORD||'FolioDemo2026!';
if(password.length<10)throw new Error('DEMO_PASSWORD must have at least 10 characters.');
const db=await connectDatabase(config);
try {await migrate(db);await seedDatabase(db,config,password);console.log('Demo data ready: anton@folio.test, mira@folio.test, lea@folio.test, nikita@folio.test, admin@folio.test. Password is DEMO_PASSWORD from your environment.');}finally{await db.close();}
