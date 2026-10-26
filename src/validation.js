import { z } from 'zod';

export const uuid = z.string().uuid('Некорректный идентификатор');
export const text = (min, max) => z.string().trim().min(min, `Минимум ${min} символов`).max(max, `Максимум ${max} символов`);
export const range = z.object({ min: z.number().min(0).max(100000000), max: z.number().min(0).max(100000000), currency: z.enum(['RUB','USD','EUR']) }).strict().refine(v => v.min <= v.max, 'Минимальная сумма не должна превышать максимальную');
export const layout = z.object({
  theme: z.enum(['paper','night','sage']).default('paper'), accent: z.string().regex(/^#[0-9a-f]{6}$/i).default('#28634b'),
  font: z.enum(['sans','serif']).default('sans'),
  sections: z.array(z.enum(['portfolio','services','about'])).length(3).refine(a => new Set(a).size === 3, 'Блоки не должны повторяться').default(['portfolio','services','about']),
  hiddenSections: z.array(z.enum(['services','about'])).max(2).default([]), columns: z.union([z.literal(2), z.literal(3)]).default(3),
}).strict();
export const profileSchema = z.object({
  publicName: text(2,80), specialization: z.array(text(2,60)).min(1).max(6), description: text(0,4000).default(''),
  avatarUrl: z.union([z.literal(''), z.string().url().refine(x => /^https?:\/\//i.test(x), 'Нужна HTTP(S)-ссылка')]).default(''),
  layoutConfig: layout.default({}), status: z.enum(['draft','published','hidden']).default('draft'),
}).strict();
export const artworkSchema = z.object({ title: text(2,120), description: text(10,8000), workType: z.enum(['model3d','illustration','animation','other']), style: text(2,60),
  technicalDetails: z.object({ polygonCount: z.number().int().min(0).max(50000000).optional(), textureResolution: text(0,60).optional(), software: text(0,120).optional(), engine: text(0,120).optional() }).strict().default({}),
  status: z.enum(['draft','published','archived']).default('draft'),
}).strict();
export const serviceSchema = z.object({ title: text(3,120), description: text(10,3000), priceRange: range, estimatedDays: z.number().int().min(1).max(730).nullable().default(null), revisionRounds: z.number().int().min(0).max(50).default(2), status: z.enum(['draft','active','hidden']).default('active') }).strict();
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата должна быть в формате ГГГГ-ММ-ДД').refine(x => !Number.isNaN(Date.parse(x)) && new Date(x).toISOString().slice(0,10) === x, 'Некорректная дата');
export const briefFields = z.object({ title: text(3,160), description: text(20,10000), budgetRange: range, desiredDeadline: dateString.nullable().optional().default(null) }).strict();
export const createBriefSchema = briefFields.extend({ authorProfileId: uuid });
export const statusSchema = z.object({ status: z.enum(['submitted','in_discussion','accepted','in_progress','completed','rejected','cancelled']), message: text(0,2000).default('') }).strict();
export const pagination = query => ({ limit: Math.max(1, Math.min(60, parseInt(String(query.limit || '18'),10) || 18)), page: Math.max(1, parseInt(String(query.page || '1'),10) || 1) });
export const body = schema => (req, _res, next) => { try { req.validated = schema.parse(req.body); next(); } catch(e) { next(e); } };
