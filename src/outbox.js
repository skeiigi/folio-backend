import { randomUUID, createHmac } from 'node:crypto';
import { all } from './db.js';

export async function enqueueBriefEvent(tx, config, eventType, brief, authorEmail) {
  const eventId = randomUUID();
  const data = { eventId, eventType, occurredAt: new Date().toISOString(), data: { id: brief.id, title: brief.title, clientUserId: brief.clientUserId, authorProfileId: brief.authorProfileId, budgetRange: brief.budgetRange, status: brief.status } };
  const targets = [];
  if (config.integrations.crmUrl) targets.push(['crm',data]);
  if (config.integrations.bpmsUrl) targets.push(['bpms',data]);
  if (config.integrations.resendKey && config.integrations.mailFrom && authorEmail) targets.push(['email',{ to: authorEmail, subject: eventType === 'brief.submitted' ? 'Folio: новый бриф' : 'Folio: статус брифа изменился', text: `Бриф «${brief.title}». Номер: ${brief.id}. Статус: ${brief.status}.` }]);
  for (const [target,payload] of targets) await tx.query('INSERT INTO event_outbox(id,event_type,target,payload) VALUES($1,$2,$3,$4::jsonb)', [randomUUID(),eventType,target,JSON.stringify(payload)]);
}

export function startOutbox(db, config) {
  let running = null;
  async function deliver() {
    const jobs = await db.transaction(async tx => {
      const rows = await all(tx, `SELECT * FROM event_outbox WHERE (status='pending' OR status='processing') AND next_attempt_at<=now() ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED`);
      for (const row of rows) await tx.query("UPDATE event_outbox SET status='processing',attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' WHERE id=$1", [row.id]);
      return rows;
    });
    for (const job of jobs) {
      try {
        let response;
        if (job.target === 'email') {
          response = await fetch('https://api.resend.com/emails', { method:'POST', headers: { Authorization:`Bearer ${config.integrations.resendKey}`, 'Content-Type':'application/json', 'Idempotency-Key':job.id }, body:JSON.stringify({ from:config.integrations.mailFrom,...job.payload }), signal:AbortSignal.timeout(10000) });
        } else {
          const body = JSON.stringify(job.payload);
          const signature = createHmac('sha256',config.integrations.secret || '').update(body).digest('hex');
          response = await fetch(job.target === 'crm' ? config.integrations.crmUrl : config.integrations.bpmsUrl, { method:'POST', headers:{ 'Content-Type':'application/json','X-Folio-Signature':`sha256=${signature}`,'X-Folio-Event-Id':job.payload.eventId }, body, signal:AbortSignal.timeout(10000) });
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await db.query("UPDATE event_outbox SET status='delivered',delivered_at=now(),last_error=NULL WHERE id=$1",[job.id]);
      } catch(e) {
        const attempts=job.attempts+1;
        await db.query('UPDATE event_outbox SET status=$1,last_error=$2,next_attempt_at=now()+($3::int * interval \'1 second\') WHERE id=$4', [attempts>=8?'failed':'pending',String(e.name==='TimeoutError'?'Timeout':e.message).slice(0,120),Math.min(3600,2**attempts*15),job.id]);
      }
    }
  }
  const tick=()=>{ if(!running) running=deliver().catch(e=>console.error('Outbox error:',e.code||e.name)).finally(()=>{running=null;}); };
  const timer=setInterval(tick,15000); timer.unref();
  return async ()=>{ clearInterval(timer); if(running) await running; };
}
