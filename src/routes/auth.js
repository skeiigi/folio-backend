import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { all, one } from '../db.js';
import { hashPassword, verifyPassword, issueToken, safeUser } from '../auth.js';
import { asyncRoute, assert } from '../errors.js';
import { body, text } from '../validation.js';

export function registerAuthRoutes(router,{db,config,auth,authLimiter}) {
  const email=z.string().trim().email('Введите корректный email').max(254).transform(x=>x.toLowerCase());
  router.post('/auth/register',authLimiter,body(z.object({name:text(2,80),email,password:z.string().min(10,'Минимум 10 символов').max(128),role:z.enum(['client','author']).default('client')}).strict()),asyncRoute(async(req,res)=>{
    const {name,email,password,role}=req.validated;
    assert(!await one(db,'SELECT id FROM users WHERE email=$1',[email]),409,'Аккаунт с таким email уже существует.','EMAIL_EXISTS');
    const user=await one(db,'INSERT INTO users(id,email,password_hash,name,roles) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING *',[randomUUID(),email,await hashPassword(password),name,JSON.stringify(role==='author'?['client','author']:['client'])]);
    res.status(201).json({user:safeUser(user),token:await issueToken(user,config),profileId:null});
  }));
  router.post('/auth/login',authLimiter,body(z.object({email,password:z.string().min(1).max(128)}).strict()),asyncRoute(async(req,res)=>{
    const user=await one(db,'SELECT * FROM users WHERE email=$1',[req.validated.email]);
    assert(user && await verifyPassword(req.validated.password,user.passwordHash) && user.status==='active',401,'Неверный email или пароль.','INVALID_CREDENTIALS');
    const profile=await one(db,'SELECT id FROM creator_profiles WHERE user_id=$1',[user.id]);
    res.json({user:safeUser(user),token:await issueToken(user,config),profileId:profile?.id||null});
  }));
  router.get('/auth/me',auth.required,asyncRoute(async(req,res)=>{
    const profile=await one(db,'SELECT id FROM creator_profiles WHERE user_id=$1',[req.user.id]);
    res.json({user:safeUser(req.user),profileId:profile?.id||null});
  }));
  router.post('/auth/logout',auth.required,asyncRoute(async(req,res)=>{
    await db.query('UPDATE users SET token_version=token_version+1 WHERE id=$1',[req.user.id]); res.status(204).end();
  }));
  router.post('/auth/become-author',auth.required,asyncRoute(async(req,res)=>{
    const roles=[...new Set([...req.user.roles,'author'])];
    const user=await one(db,'UPDATE users SET roles=$1::jsonb,updated_at=now() WHERE id=$2 RETURNING *',[JSON.stringify(roles),req.user.id]);
    res.json({user:safeUser(user)});
  }));
  router.patch('/me',auth.required,body(z.object({name:text(2,80)}).strict()),asyncRoute(async(req,res)=>{
    const user=await one(db,'UPDATE users SET name=$1,updated_at=now() WHERE id=$2 RETURNING *',[req.validated.name,req.user.id]); res.json(safeUser(user));
  }));
  router.post('/auth/password',auth.required,authLimiter,body(z.object({currentPassword:z.string().min(1).max(128),newPassword:z.string().min(10).max(128)}).strict()),asyncRoute(async(req,res)=>{
    assert(await verifyPassword(req.validated.currentPassword,req.user.passwordHash),403,'Текущий пароль не подошёл.');
    const user=await one(db,'UPDATE users SET password_hash=$1,token_version=token_version+1,updated_at=now() WHERE id=$2 RETURNING *',[await hashPassword(req.validated.newPassword),req.user.id]);
    res.json({token:await issueToken(user,config)});
  }));
  router.delete('/me',auth.required,body(z.object({password:z.string().min(1).max(128)}).strict()),asyncRoute(async(req,res)=>{
    assert(!req.user.roles.includes('admin'),409,'Администратор должен передать свою роль перед деактивацией.');
    assert(await verifyPassword(req.validated.password,req.user.passwordHash),403,'Пароль не подошёл.');
    await db.query("UPDATE users SET status='deleted',token_version=token_version+1,updated_at=now() WHERE id=$1",[req.user.id]);res.status(204).end();
  }));
}
