import { randomUUID } from "node:crypto";
import { z } from "zod";
import { all, one } from "../db.js";
import { owns, requireRole } from "../auth.js";
import { asyncRoute, assert } from "../errors.js";
import { artworkSchema, body, uuid, pagination } from "../validation.js";
import { ARTWORK_SELECT, ownedArtwork, MEDIA_FIELDS } from "../queries.js";
import { persistMedia, validateFile } from "../storage.js";

export function registerArtworkRoutes(
  router,
  { db, config, auth, upload, storage },
) {
  router.get(
    "/artworks",
    auth.optional,
    asyncRoute(async (req, res) => {
      const { limit, page } = pagination(req.query);
      const q = String(req.query.q || "").slice(0, 120);
      const type = String(req.query.workType || "");
      const style = String(req.query.style || "").slice(0, 60);
      const where =
        "a.status='published' AND p.status='published' AND u.status='active' AND (a.title ILIKE $1 OR a.description ILIKE $1 OR p.public_name ILIKE $1) AND ($2='' OR a.work_type=$2) AND ($3='' OR a.style ILIKE $3)";
      const params = [`%${q}%`, type, style];
      const count = await one(
        db,
        `SELECT count(*)::int AS total FROM artworks a JOIN creator_profiles p ON p.id=a.author_profile_id JOIN users u ON u.id=p.user_id WHERE ${where}`,
        params,
      );
      const items = await all(
        db,
        `${ARTWORK_SELECT} WHERE ${where} ORDER BY a.created_at DESC,a.id LIMIT $4 OFFSET $5`,
        [...params, limit, (page - 1) * limit],
      );
      res.json({ items, total: count.total, page, limit });
    }),
  );
  router.get(
    "/me/artworks",
    auth.required,
    requireRole("author"),
    asyncRoute(async (req, res) => {
      res.json(
        await all(
          db,
          `${ARTWORK_SELECT} WHERE p.user_id=$1 ORDER BY a.created_at DESC`,
          [req.user.id],
        ),
      );
    }),
  );
  router.get(
    "/artworks/:id",
    auth.optional,
    asyncRoute(async (req, res) => {
      uuid.parse(req.params.id);
      const a = await one(db, `${ARTWORK_SELECT} WHERE a.id=$1`, [
        req.params.id,
      ]);
      // Access fields are queried separately so public catalogue projections never include account data.
      const access = await one(
        db,
        "SELECT p.user_id,p.status,u.status AS user_status FROM creator_profiles p JOIN users u ON u.id=p.user_id WHERE p.id=$1",
        [a?.authorProfileId || null],
      );
      assert(
        a &&
          access &&
          ((a.status === "published" &&
            access.status === "published" &&
            access.userStatus === "active") ||
            owns(req.user, access.userId)),
        404,
        "Работа не найдена.",
      );
      res.json(a);
    }),
  );
  router.post(
    "/artworks",
    auth.required,
    requireRole("author"),
    body(artworkSchema),
    asyncRoute(async (req, res) => {
      const p = await one(
        db,
        "SELECT * FROM creator_profiles WHERE user_id=$1",
        [req.user.id],
      );
      assert(p, 409, "Сначала создайте профиль автора.");
      const a = req.validated;
      assert(
        a.status !== "published",
        422,
        "Сначала сохраните черновик и добавьте файлы.",
      );
      const created = await one(
        db,
        "INSERT INTO artworks(id,author_profile_id,title,description,work_type,style,technical_details,status) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *",
        [
          randomUUID(),
          p.id,
          a.title,
          a.description,
          a.workType,
          a.style,
          JSON.stringify(a.technicalDetails),
          a.status,
        ],
      );
      res
        .status(201)
        .json(await one(db, `${ARTWORK_SELECT} WHERE a.id=$1`, [created.id]));
    }),
  );
  router.patch(
    "/artworks/:id",
    auth.required,
    requireRole("author"),
    body(artworkSchema.partial()),
    asyncRoute(async (req, res) => {
      uuid.parse(req.params.id);
      const previous = await ownedArtwork(db, req.user, req.params.id);
      const fields = Object.fromEntries(
        Object.keys(artworkSchema.shape).map((k) => [k, previous[k]]),
      );
      const a = artworkSchema.parse({ ...fields, ...req.validated });
      if (a.status === "published") {
        assert(
          previous.profileStatus === "published",
          409,
          "Перед публикацией работы опубликуйте профиль автора.",
        );
        const media = await all(
          db,
          "SELECT purpose FROM media_files WHERE artwork_id=$1",
          [previous.id],
        );
        const purposes = media.map((m) => m.purpose);
        assert(
          purposes.includes("cover"),
          422,
          "Для публикации нужна обложка.",
        );
        if (a.workType === "model3d")
          assert(
            purposes.includes("model"),
            422,
            "Для 3D-работы загрузите GLB-модель.",
          );
        if (a.workType === "animation")
          assert(
            purposes.includes("preview"),
            422,
            "Для анимации загрузите GIF или MP4 в поле превью.",
          );
      }
      await db.query(
        "UPDATE artworks SET title=$1,description=$2,work_type=$3,style=$4,technical_details=$5::jsonb,status=$6,updated_at=now() WHERE id=$7",
        [
          a.title,
          a.description,
          a.workType,
          a.style,
          JSON.stringify(a.technicalDetails),
          a.status,
          previous.id,
        ],
      );
      res.json(await one(db, `${ARTWORK_SELECT} WHERE a.id=$1`, [previous.id]));
    }),
  );
  router.delete(
    "/artworks/:id",
    auth.required,
    requireRole("author"),
    asyncRoute(async (req, res) => {
      uuid.parse(req.params.id);
      await ownedArtwork(db, req.user, req.params.id);
      await db.query(
        "UPDATE artworks SET status='archived',updated_at=now() WHERE id=$1",
        [req.params.id],
      );
      res.status(204).end();
    }),
  );
  router.post(
    "/artworks/:id/media",
    auth.required,
    requireRole("author"),
    upload.single("file"),
    asyncRoute(async (req, res) => {
      uuid.parse(req.params.id);
      await ownedArtwork(db, req.user, req.params.id);
      const purpose = z
        .enum(["cover", "preview", "model"])
        .parse(req.body.purpose);
      const mime = validateFile(req.file, purpose, config.maxUploadBytes);
      const media = await persistMedia(
        db,
        storage,
        req.file,
        { artworkId: req.params.id, purpose },
        mime,
      );
      delete media.storageKey;
      res.status(201).json(media);
    }),
  );
}
