import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { connectDatabase,migrate,one } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedDatabase,DEMO_IDS } from '../src/seed.js';
import { createGlb } from '../src/demo-media.js';
import { loadConfig } from '../src/config.js';

process.env.NODE_ENV='test';
const config={production:false,dbMode:'pglite',pglitePath:':memory:',jwtSecret:'test-only-secret-for-folio-at-least-32-characters',origins:['http://localhost:5173'],maxUploadBytes:2*1024*1024,storageDriver:'postgres',integrations:{crmUrl:'https://crm.example.test/hooks',secret:'test-hook-secret'}};
const db=await connectDatabase(config);await migrate(db);await seedDatabase(db,config,'FolioDemo2026!');
const server=createApp(db,config).listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/v1`;
after(async()=>{await new Promise(r=>server.close(r));await db.close();});
async function request(path,{token,method='GET',body,form,headers={}}={}){const response=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(body?{'Content-Type':'application/json'}:{}),...headers},body:form|| (body?JSON.stringify(body):undefined)});const data=response.status===204?null:await response.json();return {status:response.status,body:data,headers:response.headers};}
async function login(email){const r=await request('/auth/login',{method:'POST',body:{email,password:'FolioDemo2026!'}});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.token;}
const client=await login('anton@folio.test'),author=await login('mira@folio.test'),admin=await login('admin@folio.test');
const stranger=(await request('/auth/register',{method:'POST',body:{name:'Другой заказчик',email:'stranger@folio.test',password:'DifferentPass123',role:'client'}})).body;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function upload(bytes,name,purpose){const form=new FormData();form.append('file',new Blob([bytes]),name);if(purpose)form.append('purpose',purpose);return form;}

test('registration enforces roles, hashes passwords and never exposes hashes',async()=>{
  assert.equal((await request('/auth/register',{method:'POST',body:{name:'Admin?',email:'escalation@folio.test',password:'SuperSecure123',role:'admin'}})).status,422);
  const r=await request('/auth/register',{method:'POST',body:{name:'Новый автор',email:'new@folio.test',password:'SuperSecure123',role:'author'}});assert.equal(r.status,201);assert.deepEqual(r.body.user.roles,['client','author']);assert.ok(!('passwordHash' in r.body.user));
  const row=await one(db,'SELECT password_hash FROM users WHERE id=$1',[r.body.user.id]);assert.match(row.passwordHash,/^scrypt:/);assert.ok(!row.passwordHash.includes('SuperSecure123'));
  assert.equal((await request('/auth/me')).status,401);assert.equal((await request('/auth/me',{token:r.body.token})).status,200);
});
test('public catalogue filters and streams an actual glTF 2.0 binary',async()=>{
  const r=await request('/artworks?workType=model3d');assert.equal(r.status,200);assert.equal(r.body.total,2);assert.ok(r.body.items.every(x=>x.workType==='model3d'));
  const model=r.body.items[0].media.find(x=>x.purpose==='model');const raw=await fetch(base+`/media/${model.id}/content`);const b=Buffer.from(await raw.arrayBuffer());assert.equal(b.toString('ascii',0,4),'glTF');assert.equal(b.readUInt32LE(8),b.length);assert.equal(raw.headers.get('content-type'),'model/gltf-binary');
  const ranged=await fetch(base+`/media/${model.id}/content`,{headers:{Range:'bytes=0-11'}});assert.equal(ranged.status,206);assert.equal((await ranged.arrayBuffer()).byteLength,12);
  assert.equal((await request('/artworks?q=далёких')).body.total,1);
});
test('profile customization persists and another account cannot modify it',async()=>{
  const r=await request(`/creators/${DEMO_IDS.profile}`,{method:'PATCH',token:author,body:{layoutConfig:{theme:'sage',accent:'#336644',font:'serif',sections:['services','portfolio','about'],hiddenSections:[],columns:2}}});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.layoutConfig.theme,'sage');
  assert.equal((await request(`/creators/${DEMO_IDS.profile}`,{method:'PATCH',token:stranger.token,body:{publicName:'Stolen'}})).status,403);
  assert.equal((await request(`/creators/${DEMO_IDS.profile}`,{method:'PATCH',token:author,body:{layoutConfig:{theme:'night',html:'<script>bad()</script>'}}})).status,422);
});
test('author publishes a draft with a cover and real GLB; ownership and file signatures are checked',async()=>{
  const body={title:'Новая модель',description:'Подробное описание новой модели для проверки публикации.',workType:'model3d',style:'Low-poly'};
  const r=await request('/artworks',{method:'POST',token:author,body});assert.equal(r.status,201);const id=r.body.id;
  assert.equal((await request(`/artworks/${id}`)).status,404);
  assert.equal((await request(`/artworks/${id}`,{method:'PATCH',token:stranger.token,body:{title:'Hijack'}})).status,403);
  assert.equal((await request(`/artworks/${id}`,{method:'PATCH',token:author,body:{status:'published'}})).status,422);
  assert.equal((await request(`/artworks/${id}/media`,{method:'POST',token:author,form:upload(Buffer.from('<script>bad</script>'),'bad.png','cover')})).status,422);
  assert.equal((await request(`/artworks/${id}/media`,{method:'POST',token:author,form:upload(png,'cover.png','cover')})).status,201);
  assert.equal((await request(`/artworks/${id}/media`,{method:'POST',token:author,form:upload(createGlb(),'model.glb','model')})).status,201);
  const pub=await request(`/artworks/${id}`,{method:'PATCH',token:author,body:{status:'published'}});assert.equal(pub.status,200);assert.equal((await request(`/artworks/${id}`)).status,200);
});
test('brief identity is server-owned; references and details are private; transitions enforce ownership',async()=>{
  const input={authorProfileId:DEMO_IDS.profile,title:'Нужен игровой пропс',description:'Нужна стилизованная модель небольшого предмета с двумя наборами текстур.',budgetRange:{min:5000,max:10000,currency:'RUB'}};
  assert.equal((await request('/briefs',{method:'POST',token:client,body:{...input,clientUserId:DEMO_IDS.mira}})).status,422);
  const r=await request('/briefs',{method:'POST',token:client,body:input});assert.equal(r.status,201);assert.equal(r.body.clientUserId,DEMO_IDS.client);const id=r.body.id;
  assert.equal((await request(`/briefs/${id}`)).status,401);assert.equal((await request(`/briefs/${id}`,{token:stranger.token})).status,403);
  const file=await request(`/briefs/${id}/attachments`,{method:'POST',token:client,form:upload(png,'reference.png')});assert.equal(file.status,201);
  assert.equal((await fetch(base+`/media/${file.body.id}/content`)).status,401);
  assert.equal((await fetch(base+`/media/${file.body.id}/content`,{headers:{Authorization:`Bearer ${stranger.token}`}})).status,403);
  assert.equal((await fetch(base+`/media/${file.body.id}/content`,{headers:{Authorization:`Bearer ${author}`}})).status,200);
  assert.equal((await request(`/briefs/${id}/status`,{method:'PATCH',token:client,body:{status:'accepted'}})).status,409);
  assert.equal((await request(`/briefs/${id}/status`,{method:'PATCH',token:author,body:{status:'completed'}})).status,409);
  const edited=await request(`/briefs/${id}`,{method:'PATCH',token:client,body:{title:'Уточнённый игровой пропс'}});assert.equal(edited.status,200);
  for(const status of ['in_discussion','accepted','in_progress','completed'])assert.equal((await request(`/briefs/${id}/status`,{method:'PATCH',token:author,body:{status}})).status,200);
  assert.equal((await request(`/briefs/${id}`,{method:'PATCH',token:client,body:{title:'Позднее изменение'}})).status,409);
  assert.equal((await request(`/briefs/${id}/attachments/${file.body.id}`,{method:'DELETE',token:client})).status,409);
  const outbox=await one(db,'SELECT * FROM event_outbox WHERE payload->\'data\'->>\'id\'=$1 ORDER BY created_at LIMIT 1',[id]);assert.equal(outbox.status,'pending');assert.equal(outbox.eventType,'brief.submitted');assert.ok(!JSON.stringify(outbox.payload).includes('password'));
  const detail=await request(`/briefs/${id}`,{token:client});assert.equal(detail.body.history.length,5);assert.deepEqual(detail.body.allowedTransitions,[]);
});
test('invalid budget, deadline, oversized uploads and untrusted origins are rejected',async()=>{
  const body={authorProfileId:DEMO_IDS.profile,title:'Тест бюджета',description:'Достаточно подробное описание задачи для проверки данных.',budgetRange:{min:10000,max:100,currency:'RUB'}};
  assert.equal((await request('/briefs',{method:'POST',token:client,body})).status,422);
  assert.equal((await request('/briefs',{method:'POST',token:client,body:{...body,budgetRange:{min:1,max:2,currency:'RUB'},desiredDeadline:'2024-01-01'}})).status,422);
  assert.equal((await request('/artworks',{headers:{Origin:'https://untrusted.example'}})).status,403);
  const large=Buffer.alloc(config.maxUploadBytes+10);png.copy(large);assert.equal((await request(`/artworks/30000000-0000-4000-8000-000000000001/media`,{method:'POST',token:author,form:upload(large,'big.png','cover')})).status,413);
});
test('database enforces exactly one MediaFile parent',async()=>{
  await assert.rejects(()=>db.query('INSERT INTO media_files(id,purpose,file_name,storage_key,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),'reference','x.png',randomUUID(),'image/png',1]),e=>e.code==='23514');
});
test('administrator blocking invalidates an existing session; clients cannot use admin APIs',async()=>{
  assert.equal((await request('/admin/users',{token:client})).status,403);
  assert.equal((await request(`/admin/users/${stranger.user.id}/status`,{method:'PATCH',token:admin,body:{status:'blocked'}})).status,200);
  assert.equal((await request('/auth/me',{token:stranger.token})).status,401);
});
test('production refuses local database and placeholder secrets',()=>{
  assert.throws(()=>loadConfig({NODE_ENV:'production'}),/DATABASE_URL/);
  assert.throws(()=>loadConfig({NODE_ENV:'production',DATABASE_URL:'postgres://test',JWT_SECRET:'short',CORS_ORIGINS:'https://folio.example'}),/JWT_SECRET/);
});
