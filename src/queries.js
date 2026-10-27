import { one, all } from "./db.js";
import { assert } from "./errors.js";
import { owns } from "./auth.js";

export const MEDIA_FIELDS =
  "id,artwork_id,brief_id,purpose,file_name,mime_type,size_bytes,created_at,updated_at";
export const ARTWORK_SELECT = `SELECT a.*, (a.status='published' AND p.status='published' AND u.status='active') AS is_public, jsonb_build_object('id',p.id,'publicName',p.public_name,'specialization',p.specialization,'avatarUrl',p.avatar_url,'layoutConfig',p.layout_config) AS author,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'purpose',m.purpose,'fileName',m.file_name,'mimeType',m.mime_type,'sizeBytes',m.size_bytes)) FROM media_files m WHERE m.artwork_id=a.id),'[]') AS media
  FROM artworks a JOIN creator_profiles p ON p.id=a.author_profile_id JOIN users u ON u.id=p.user_id`;
export async function ownedProfile(db, user, profileId) {
  const p = await one(db, "SELECT * FROM creator_profiles WHERE id=$1", [
    profileId,
  ]);
  assert(p, 404, "Профиль не найден.");
  assert(owns(user, p.userId), 403, "Это профиль другого автора.");
  return p;
}
export async function ownedArtwork(db, user, id) {
  const a = await one(
    db,
    "SELECT a.*,p.user_id AS owner_id,p.status AS profile_status FROM artworks a JOIN creator_profiles p ON p.id=a.author_profile_id WHERE a.id=$1",
    [id],
  );
  assert(a, 404, "Работа не найдена.");
  assert(owns(user, a.ownerId), 403, "Это работа другого автора.");
  return a;
}
export async function accessibleBrief(db, user, id) {
  const b = await one(
    db,
    `SELECT b.*,p.user_id AS author_user_id,p.public_name AS author_name,u.name AS client_name,u.email AS client_email,au.email AS author_email
    FROM briefs b JOIN creator_profiles p ON p.id=b.author_profile_id JOIN users u ON u.id=b.client_user_id JOIN users au ON au.id=p.user_id WHERE b.id=$1`,
    [id],
  );
  assert(b, 404, "Бриф не найден.");
  assert(
    owns(user, b.clientUserId) || owns(user, b.authorUserId),
    403,
    "Этот бриф доступен только его участникам.",
  );
  return b;
}
export const EDITABLE_BRIEF_STATUSES = ["submitted", "in_discussion"];
export function transitionsFor(user, brief) {
  if (user.roles.includes("admin"))
    return [
      "submitted",
      "in_discussion",
      "accepted",
      "in_progress",
      "completed",
      "rejected",
      "cancelled",
    ].filter((s) => s !== brief.status);
  if (user.id === brief.clientUserId)
    return EDITABLE_BRIEF_STATUSES.includes(brief.status) ? ["cancelled"] : [];
  if (user.id !== brief.authorUserId) return [];
  return (
    {
      submitted: ["in_discussion", "accepted", "rejected"],
      in_discussion: ["accepted", "rejected"],
      accepted: ["in_progress"],
      in_progress: ["completed"],
    }[brief.status] || []
  );
}
export async function fullBrief(db, user, id) {
  const b = await accessibleBrief(db, user, id);
  const attachments = await all(
    db,
    `SELECT ${MEDIA_FIELDS} FROM media_files WHERE brief_id=$1 ORDER BY created_at`,
    [id],
  );
  const history = await all(
    db,
    "SELECT e.*,u.name AS actor_name FROM brief_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.brief_id=$1 ORDER BY e.created_at,e.id",
    [id],
  );
  return {
    ...b,
    attachments,
    history,
    allowedTransitions: transitionsFor(user, b),
    canEdit:
      owns(user, b.clientUserId) && EDITABLE_BRIEF_STATUSES.includes(b.status),
  };
}
