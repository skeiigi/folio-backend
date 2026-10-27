import { randomUUID } from "node:crypto";
import { all, one } from "../db.js";
import { owns, requireRole, isAdmin } from "../auth.js";
import { asyncRoute, assert } from "../errors.js";
import {
  briefFields,
  createBriefSchema,
  statusSchema,
  body,
  uuid,
  pagination,
} from "../validation.js";
import {
  accessibleBrief,
  fullBrief,
  EDITABLE_BRIEF_STATUSES,
  transitionsFor,
} from "../queries.js";
import { persistMedia, validateFile } from "../storage.js";
import { enqueueBriefEvent } from "../outbox.js";

function validateDeadline(date) {
  if (date)
    assert(
      date >= new Date().toISOString().slice(0, 10),
      422,
      "Желаемый срок не может быть в прошлом.",
    );
}

export function registerBriefRoutes(
  router,
  { db, config, auth, upload, storage },
) {
  router.post(
    "/briefs",
    auth.required,
    requireRole("client"),
    body(createBriefSchema),
    asyncRoute(async (req, res) => {
      const input = req.validated;
      validateDeadline(input.desiredDeadline);
      const profile = await one(
        db,
        "SELECT p.*,u.email,u.status AS user_status FROM creator_profiles p JOIN users u ON u.id=p.user_id WHERE p.id=$1",
        [input.authorProfileId],
      );
      assert(
        profile &&
          profile.status === "published" &&
          profile.userStatus === "active",
        404,
        "Автор сейчас не принимает брифы.",
      );
      assert(
        profile.userId !== req.user.id,
        422,
        "Нельзя отправить бриф самому себе.",
      );
      const id = randomUUID();
      await db.transaction(async (tx) => {
        const b = await one(
          tx,
          "INSERT INTO briefs(id,client_user_id,author_profile_id,title,description,budget_range,desired_deadline) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *",
          [
            id,
            req.user.id,
            input.authorProfileId,
            input.title,
            input.description,
            JSON.stringify(input.budgetRange),
            input.desiredDeadline,
          ],
        );
        await tx.query(
          "INSERT INTO brief_events(id,brief_id,actor_user_id,to_status,message) VALUES($1,$2,$3,$4,$5)",
          [randomUUID(), id, req.user.id, "submitted", "Бриф отправлен автору"],
        );
        await enqueueBriefEvent(
          tx,
          config,
          "brief.submitted",
          b,
          profile.email,
        );
      });
      res.status(201).json(await fullBrief(db, req.user, id));
    }),
  );
  router.get(
    "/me/briefs",
    auth.required,
    asyncRoute(async (req, res) => {
      const { limit, page } = pagination(req.query);
      const side = req.query.side === "received" ? "received" : "sent";
      const status = String(req.query.status || "");
      if (side === "received")
        assert(
          req.user.roles.includes("author") || isAdmin(req.user),
          403,
          "Полученные брифы доступны авторам.",
        );
      const where = `${side === "received" ? "p.user_id" : "b.client_user_id"}=$1 AND ($2='' OR b.status=$2)`;
      const count = await one(
        db,
        `SELECT count(*)::int AS total FROM briefs b JOIN creator_profiles p ON p.id=b.author_profile_id WHERE ${where}`,
        [req.user.id, status],
      );
      const items = await all(
        db,
        `SELECT b.*,p.public_name AS author_name,u.name AS client_name FROM briefs b JOIN creator_profiles p ON p.id=b.author_profile_id JOIN users u ON u.id=b.client_user_id WHERE ${where} ORDER BY b.created_at DESC LIMIT $3 OFFSET $4`,
        [req.user.id, status, limit, (page - 1) * limit],
      );
      res.json({ items, total: count.total, page, limit });
    }),
  );
  router.get(
    "/briefs/:id",
    auth.required,
    asyncRoute(async (req, res) => {
      uuid.parse(req.params.id);
      res.json(await fullBrief(db, req.user, req.params.id));
    }),
  );
  router.patch(
    "/briefs/:id",
    auth.required,
    body(briefFields.partial()),
    asyncRoute(async (req, res) => {
      uuid.parse(req.params.id);
      await db.transaction(async (tx) => {
        await tx.query("SELECT id FROM briefs WHERE id=$1 FOR UPDATE", [
          req.params.id,
        ]);
        const previous = await accessibleBrief(tx, req.user, req.params.id);
        assert(
          owns(req.user, previous.clientUserId),
          403,
          "Редактировать бриф может его заказчик.",
        );
        assert(
          EDITABLE_BRIEF_STATUSES.includes(previous.status),
          409,
          "После принятия бриф нельзя редактировать.",
        );
        const fields = Object.fromEntries(
          Object.keys(briefFields.shape).map((k) => [k, previous[k]]),
        );
        if (fields.desiredDeadline instanceof Date)
          fields.desiredDeadline = fields.desiredDeadline
            .toISOString()
            .slice(0, 10);
        if (typeof fields.desiredDeadline === "string")
          fields.desiredDeadline = fields.desiredDeadline.slice(0, 10);
        const b = briefFields.parse({ ...fields, ...req.validated });
        if ("desiredDeadline" in req.validated)
          validateDeadline(b.desiredDeadline);
        await tx.query(
          "UPDATE briefs SET title=$1,description=$2,budget_range=$3::jsonb,desired_deadline=$4,updated_at=now() WHERE id=$5",
          [
            b.title,
            b.description,
            JSON.stringify(b.budgetRange),
            b.desiredDeadline,
            previous.id,
          ],
        );
      });
      res.json(await fullBrief(db, req.user, req.params.id));
    }),
  );
  router.patch(
    "/briefs/:id/status",
    auth.required,
    body(statusSchema),
    asyncRoute(async (req, res) => {
      uuid.parse(req.params.id);
      await db.transaction(async (tx) => {
        await tx.query("SELECT id FROM briefs WHERE id=$1 FOR UPDATE", [
          req.params.id,
        ]);
        const before = await accessibleBrief(tx, req.user, req.params.id);
        assert(
          transitionsFor(req.user, before).includes(req.validated.status),
          409,
          "Такой переход статуса недоступен.",
        );
        const b = await one(
          tx,
          "UPDATE briefs SET status=$1,updated_at=now() WHERE id=$2 RETURNING *",
          [req.validated.status, before.id],
        );
        await tx.query(
          "INSERT INTO brief_events(id,brief_id,actor_user_id,from_status,to_status,message) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            b.id,
            req.user.id,
            before.status,
            b.status,
            req.validated.message,
          ],
        );
        await enqueueBriefEvent(
          tx,
          config,
          "brief.status_changed",
          b,
          req.user.id === before.clientUserId
            ? before.authorEmail
            : before.clientEmail,
        );
      });
      res.json(await fullBrief(db, req.user, req.params.id));
    }),
  );
  router.post(
    "/briefs/:id/attachments",
    auth.required,
    upload.single("file"),
    asyncRoute(async (req, res) => {
      uuid.parse(req.params.id);
      const b = await accessibleBrief(db, req.user, req.params.id);
      assert(
        owns(req.user, b.clientUserId),
        403,
        "Референсы добавляет заказчик брифа.",
      );
      assert(
        EDITABLE_BRIEF_STATUSES.includes(b.status),
        409,
        "Бриф уже принят или закрыт.",
      );
      const count = await one(
        db,
        "SELECT count(*)::int AS total FROM media_files WHERE brief_id=$1",
        [b.id],
      );
      assert(count.total < 10, 422, "Можно прикрепить не больше 10 файлов.");
      const mime = validateFile(req.file, "reference", config.maxUploadBytes);
      const media = await persistMedia(
        db,
        storage,
        req.file,
        { briefId: b.id, purpose: "reference" },
        mime,
      );
      delete media.storageKey;
      res.status(201).json(media);
    }),
  );
  router.delete(
    "/briefs/:id/attachments/:fileId",
    auth.required,
    asyncRoute(async (req, res) => {
      uuid.parse(req.params.id);
      uuid.parse(req.params.fileId);
      const b = await accessibleBrief(db, req.user, req.params.id);
      assert(
        owns(req.user, b.clientUserId),
        403,
        "Удалить референс может заказчик.",
      );
      assert(
        EDITABLE_BRIEF_STATUSES.includes(b.status),
        409,
        "Бриф уже принят или закрыт.",
      );
      const m = await one(
        db,
        "DELETE FROM media_files WHERE id=$1 AND brief_id=$2 RETURNING storage_key",
        [req.params.fileId, b.id],
      );
      assert(m, 404, "Вложение не найдено.");
      await storage.remove(m.storageKey);
      res.status(204).end();
    }),
  );
}
