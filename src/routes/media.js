import { one } from '../db.js';
import { owns } from '../auth.js';
import { asyncRoute,assert } from '../errors.js';
import { uuid } from '../validation.js';
import { accessibleBrief,ownedArtwork } from '../queries.js';

export function registerMediaRoutes(router,{db,auth,storage}) {
  router.get('/media/:id/content',auth.optional,asyncRoute(async(req,res)=>{
    uuid.parse(req.params.id);const m=await one(db,'SELECT * FROM media_files WHERE id=$1',[req.params.id]);assert(m,404,'Файл не найден.');let publicFile=false;
    if(m.artworkId) {
      const a=await one(db,'SELECT a.status,p.status AS profile_status,p.user_id,u.status AS user_status FROM artworks a JOIN creator_profiles p ON p.id=a.author_profile_id JOIN users u ON u.id=p.user_id WHERE a.id=$1',[m.artworkId]);
      publicFile=a?.status==='published'&&a.profileStatus==='published'&&a.userStatus==='active';assert(publicFile||owns(req.user,a?.userId),404,'Файл не найден.');
    } else { assert(req.user,401,'Для просмотра референса нужно войти.');await accessibleBrief(db,req.user,m.briefId); }
    const bytes=await storage.get(m.storageKey);res.set({'Content-Type':m.mimeType,'X-Content-Type-Options':'nosniff','Cache-Control':publicFile?'public, max-age=3600':'private, no-store','Accept-Ranges':'bytes'});
    if(m.briefId) res.set('Content-Disposition',`attachment; filename="reference"; filename*=UTF-8''${encodeURIComponent(m.fileName)}`);
    if(m.mimeType==='image/svg+xml') res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; sandbox");
    const range=req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if(range) {
      let start=range[1]?Number(range[1]):Math.max(0,bytes.length-Number(range[2]));let end=range[1]&&range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;
      if(start>end||start>=bytes.length) return res.status(416).set('Content-Range',`bytes */${bytes.length}`).end();
      return res.status(206).set({'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}).send(bytes.subarray(start,end+1));
    }
    res.set('Content-Length',String(bytes.length)).send(bytes);
  }));
  router.delete('/media/:id',auth.required,asyncRoute(async(req,res)=>{
    uuid.parse(req.params.id);const m=await one(db,'SELECT * FROM media_files WHERE id=$1',[req.params.id]);assert(m,404,'Файл не найден.');
    assert(m.artworkId,422,'Вложения брифа удаляются через адрес брифа.');const a=await ownedArtwork(db,req.user,m.artworkId);
    assert(a.status!=='published'||m.purpose==='preview',409,'Сначала снимите работу с публикации.');
    await db.query('DELETE FROM media_files WHERE id=$1',[m.id]);await storage.remove(m.storageKey);res.status(204).end();
  }));
}
