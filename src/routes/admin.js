import { z } from "zod";
import { all, one } from "../db.js";
import { requireRole } from "../auth.js";
import { asyncRoute, assert } from "../errors.js";
import { uuid, body } from "../validation.js";
import { ARTWORK_SELECT } from "../queries.js";

export function registerAdminRoutes(router, { db, auth }) {
  router.get(
    "/admin/users",
    auth.required,
    requireRole("admin"),
    asyncRoute(async (_req, res) => {
      res.json(
        await all(
          db,
          "SELECT id,name,email,roles,status,created_at FROM users ORDER BY created_at DESC LIMIT 100",
        ),
      );
    }),
  );
  router.patch(
    "/admin/users/:id/status",
    auth.required,
    requireRole("admin"),
    body(z.object({ status: z.enum(["active", "blocked"]) }).strict()),
    asyncRoute(async (req, res) => {
      uuid.parse(req.params.id);
      assert(
        req.params.id !== req.user.id,
        409,
        "Нельзя заблокировать собственный аккаунт администратора.",
      );
      const u = await one(db, "SELECT id,roles,status FROM users WHERE id=$1", [
        req.params.id,
      ]);
      assert(u, 404, "Пользователь не найден.");
      assert(
        !u.roles.includes("admin"),
        409,
        "Изменение другого администратора выполняется через оператора базы.",
      );
      assert(u.status !== "deleted", 409, "Аккаунт деактивирован владельцем.");
      res.json(
        await one(
          db,
          "UPDATE users SET status=$1,token_version=token_version+1,updated_at=now() WHERE id=$2 RETURNING id,name,email,roles,status",
          [req.validated.status, u.id],
        ),
      );
    }),
  );
  router.get(
    "/admin/artworks",
    auth.required,
    requireRole("admin"),
    asyncRoute(async (_req, res) => {
      res.json(
        await all(db, `${ARTWORK_SELECT} ORDER BY a.created_at DESC LIMIT 100`),
      );
    }),
  );
  router.get(
    "/admin/outbox",
    auth.required,
    requireRole("admin"),
    asyncRoute(async (_req, res) => {
      res.json(
        await all(
          db,
          "SELECT id,event_type,target,status,attempts,last_error,created_at,delivered_at FROM event_outbox ORDER BY created_at DESC LIMIT 100",
        ),
      );
    }),
  );
}
