import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { authentication } from './auth.js';
import { ApiError,asyncRoute } from './errors.js';
import { one } from './db.js';
import { createStorage } from './storage.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCreatorRoutes } from './routes/creators.js';
import { registerArtworkRoutes } from './routes/artworks.js';
import { registerBriefRoutes } from './routes/briefs.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerAdminRoutes } from './routes/admin.js';
import { openapi } from './openapi.js';

export function createApp(db,config) {
  const app=express();app.disable('x-powered-by');app.set('trust proxy',config.production?1:false);
  app.use((req,res,next)=>{req.id=randomUUID();res.set('X-Request-Id',req.id);next();});
  app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'}}));
  app.use(cors({origin:(origin,cb)=>cb(!origin||config.origins.includes(origin)?null:new ApiError(403,'Этот сайт не имеет доступа к API.','ORIGIN_NOT_ALLOWED'),true),exposedHeaders:['Content-Disposition','X-Request-Id']}));
  app.use(express.json({limit:'1mb'}));
  app.get('/health',(_req,res)=>res.json({status:'ok',service:'folio-api'}));
  app.get('/ready',asyncRoute(async(_req,res)=>{await db.query('SELECT 1');res.json({status:'ready'});}));
  const limiter=rateLimit({windowMs:60000,limit:180,standardHeaders:'draft-7',legacyHeaders:false,message:{error:{code:'RATE_LIMIT',message:'Слишком много запросов. Попробуйте через минуту.'}}});
  const authLimiter=rateLimit({windowMs:15*60000,limit:25,standardHeaders:'draft-7',legacyHeaders:false,message:{error:{code:'AUTH_RATE_LIMIT',message:'Слишком много попыток входа. Попробуйте позже.'}}});
  const router=express.Router();router.use(limiter);
  const context={db,config,auth:authentication(db,config),storage:createStorage(db,config),upload:multer({storage:multer.memoryStorage(),limits:{fileSize:config.maxUploadBytes,files:1,fields:10}}),authLimiter};
  router.get('/meta',asyncRoute(async(_req,res)=>{const stats=await one(db,"SELECT (SELECT count(*)::int FROM artworks a JOIN creator_profiles p ON p.id=a.author_profile_id JOIN users u ON u.id=p.user_id WHERE a.status='published' AND p.status='published' AND u.status='active') AS artworks,(SELECT count(*)::int FROM creator_profiles p JOIN users u ON u.id=p.user_id WHERE p.status='published' AND u.status='active') AS creators");res.json({maxUploadBytes:config.maxUploadBytes,stats});}));
  router.get('/openapi.json',(_req,res)=>res.json(openapi));
  for(const register of [registerAuthRoutes,registerCreatorRoutes,registerArtworkRoutes,registerBriefRoutes,registerMediaRoutes,registerAdminRoutes]) register(router,context);
  app.use('/api/v1',router);
  app.use((_req,_res,next)=>next(new ApiError(404,'Адрес не найден.','NOT_FOUND')));
  app.use((err,req,res,_next)=>{
    if(err instanceof ZodError) return res.status(422).json({error:{code:'VALIDATION_ERROR',message:'Проверьте заполненные поля.',details:err.flatten().fieldErrors},requestId:req.id});
    if(err instanceof multer.MulterError) return res.status(err.code==='LIMIT_FILE_SIZE'?413:422).json({error:{code:err.code,message:'Файл слишком большой или формат запроса неверен.'},requestId:req.id});
    if(err.code==='23505') return res.status(409).json({error:{code:'CONFLICT',message:'Такая запись уже существует.'},requestId:req.id});
    const status=err instanceof ApiError?err.status:err.type==='entity.too.large'?413:err instanceof SyntaxError?400:500;
    if(status===500 && process.env.NODE_ENV!=='test') console.error('Request failed:',req.id,err.code||err.name);
    res.status(status).json({error:{code:err instanceof ApiError?err.code:'SERVER_ERROR',message:err instanceof ApiError?err.message:status===400?'Некорректный JSON.':status===413?'Запрос слишком большой.':'Не удалось выполнить запрос. Попробуйте ещё раз.'},requestId:req.id});
  });
  return app;
}
