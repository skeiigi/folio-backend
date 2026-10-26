import { loadConfig } from './config.js';
import { connectDatabase,migrate } from './db.js';
import { createApp } from './app.js';
import { startOutbox } from './outbox.js';

const config=loadConfig();
const db=await connectDatabase(config);
await migrate(db);
const app=createApp(db,config);
const stopOutbox=startOutbox(db,config);
const server=app.listen(config.port,'0.0.0.0',()=>console.log(`Folio API listening on http://localhost:${config.port} (${config.dbMode})`));
let stopping=false;
async function stop() {if(stopping)return;stopping=true;await new Promise(resolve=>server.close(resolve));await stopOutbox();await db.close();}
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>stop().then(()=>process.exit(0)).catch(()=>process.exit(1)));
