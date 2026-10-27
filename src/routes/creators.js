import { randomUUID } from "node:crypto";
import { z } from "zod";
import { all, one } from "../db.js";
import { owns, requireRole } from "../auth.js";
import { asyncRoute, assert } from "../errors.js";
import {
  profileSchema,
  serviceSchema,
  body,
  uuid,
  pagination,
} from "../validation.js";
import { ownedProfile, ARTWORK_SELECT } from "../queries.js";

export function registerCreatorRoutes(router, { db, auth }) {
  router.get(
    "/creators",
    auth.optional,
    asyncRoute(async (req, res) => {
      const { limit, page } = pagination(req.query);
      const search = String(req.query.q || "").slice(0, 120);
      const where =
        "p.status='published' AND u.status='active' AND (p.public_name ILIKE $1 OR p.description ILIKE $1 OR p.specialization::text ILIKE $1)";
      const count = await one(
        db,
        `SELECT count(*)::int AS total FROM creator_profiles p JOIN users u ON u.id=p.user_id WHERE ${where}`,
        [`%${search}%`],
      );
      const items = await all(
        db,
        `SELECT p.*,(SELECT count(*)::int FROM artworks a WHERE a.author_profile_id=p.id AND a.status='published') AS artwork_count FROM creator_profiles p JOIN users u ON u.id=p.user_id WHERE ${where} ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
        [`%${search}%`, limit, (page - 1) * limit],
      );
      res.json({ items, total: count.total, page, limit });
    }),
  );
  router.get(
    "/me/profile",
    auth.required,
    asyncRoute(async (req, res) => {
      res.json(
        await one(db, "SELECT * FROM creator_profiles WHERE user_id=$1", [
          req.user.id,
        ]),
      );
    }),
  );
  router.get(
    "/creators/:id",
    auth.optional,
    asyncRoute(async (req, res) => {
      uuid.parse(req.params.id);
      const p = await one(
        db,
        "SELECT p.*,u.status AS user_status FROM creator_profiles p JOIN users u ON u.id=p.user_id WHERE p.id=$1",
        [req.params.id],
      );
      assert(
        p &&
          ((p.status === "published" && p.userStatus === "active") ||
            owns(req.user, p.userId)),
        404,
        "Профиль не найден.",
      );
      const own = owns(req.user, p.userId);
      const artworks = await all(
        db,
        `${ARTWORK_SELECT} WHERE a.author_profile_id=$1 ${own ? "" : "AND a.status='published'"} ORDER BY a.created_at DESC`,
        [p.id],
      );
      const services = await all(
        db,
        `SELECT * FROM services WHERE author_profile_id=$1 ${own ? "" : "AND status='active'"} ORDER BY created_at`,
        [p.id],
      );
      delete p.userStatus;
      res.json({ ...p, artworks, services });
    }),
  );
  router.post(
    "/creator-profiles",
    auth.required,
    requireRole("author"),
    body(profileSchema),
    asyncRoute(async (req, res) => {
      assert(
        !(await one(db, "SELECT id FROM creator_profiles WHERE user_id=$1", [
          req.user.id,
        ])),
        409,
        "У вас уже есть профиль автора.",
      );
      const p = req.validated;
      res
        .status(201)
        .json(
          await one(
            db,
            "INSERT INTO creator_profiles(id,user_id,public_name,specialization,description,avatar_url,layout_config,status) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8) RETURNING *",
            [
              randomUUID(),
              req.user.id,
              p.publicName,
              JSON.stringify(p.specialization),
              p.description,
              p.avatarUrl,
              JSON.stringify(p.layoutConfig),
              p.status,
            ],
          ),
        );
    }),
  );
  router.patch(
    "/creators/:id",
    auth.required,
    requireRole("author"),
    body(profileSchema.partial()),
    asyncRoute(async (req, res) => {
      uuid.parse(req.params.id);
      const previous = await ownedProfile(db, req.user, req.params.id);
      const fields = Object.fromEntries(
        Object.keys(profileSchema.shape).map((k) => [k, previous[k]]),
      );
      const p = profileSchema.parse({ ...fields, ...req.validated });
      res.json(
        await one(
          db,
          "UPDATE creator_profiles SET public_name=$1,specialization=$2::jsonb,description=$3,avatar_url=$4,layout_config=$5::jsonb,status=$6,updated_at=now() WHERE id=$7 RETURNING *",
          [
            p.publicName,
            JSON.stringify(p.specialization),
            p.description,
            p.avatarUrl,
            JSON.stringify(p.layoutConfig),
            p.status,
            previous.id,
          ],
        ),
      );
    }),
  );
  router.get(
    "/me/services",
    auth.required,
    requireRole("author"),
    asyncRoute(async (req, res) => {
      res.json(
        await all(
          db,
          "SELECT s.* FROM services s JOIN creator_profiles p ON p.id=s.author_profile_id WHERE p.user_id=$1 ORDER BY s.created_at DESC",
          [req.user.id],
        ),
      );
    }),
  );
  router.post(
    "/services",
    auth.required,
    requireRole("author"),
    body(serviceSchema),
    asyncRoute(async (req, res) => {
      const p = await one(
        db,
        "SELECT id FROM creator_profiles WHERE user_id=$1",
        [req.user.id],
      );
      assert(p, 409, "Сначала создайте профиль автора.");
      const s = req.validated;
      res
        .status(201)
        .json(
          await one(
            db,
            "INSERT INTO services(id,author_profile_id,title,description,price_range,estimated_days,revision_rounds,status) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *",
            [
              randomUUID(),
              p.id,
              s.title,
              s.description,
              JSON.stringify(s.priceRange),
              s.estimatedDays,
              s.revisionRounds,
              s.status,
            ],
          ),
        );
    }),
  );
  router.patch(
    "/services/:id",
    auth.required,
    requireRole("author"),
    body(serviceSchema.partial()),
    asyncRoute(async (req, res) => {
      uuid.parse(req.params.id);
      const old = await one(db, "SELECT * FROM services WHERE id=$1", [
        req.params.id,
      ]);
      assert(old, 404, "Услуга не найдена.");
      await ownedProfile(db, req.user, old.authorProfileId);
      const input = {
        title: old.title,
        description: old.description,
        priceRange: old.priceRange,
        estimatedDays: old.estimatedDays,
        revisionRounds: old.revisionRounds,
        status: old.status,
        ...req.validated,
      };
      const s = serviceSchema.parse(input);
      res.json(
        await one(
          db,
          "UPDATE services SET title=$1,description=$2,price_range=$3::jsonb,estimated_days=$4,revision_rounds=$5,status=$6,updated_at=now() WHERE id=$7 RETURNING *",
          [
            s.title,
            s.description,
            JSON.stringify(s.priceRange),
            s.estimatedDays,
            s.revisionRounds,
            s.status,
            old.id,
          ],
        ),
      );
    }),
  );
  router.delete(
    "/services/:id",
    auth.required,
    requireRole("author"),
    asyncRoute(async (req, res) => {
      uuid.parse(req.params.id);
      const s = await one(db, "SELECT * FROM services WHERE id=$1", [
        req.params.id,
      ]);
      assert(s, 404, "Услуга не найдена.");
      await ownedProfile(db, req.user, s.authorProfileId);
      await db.query(
        "UPDATE services SET status='hidden',updated_at=now() WHERE id=$1",
        [s.id],
      );
      res.status(204).end();
    }),
  );
}
