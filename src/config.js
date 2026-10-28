import "dotenv/config";
import { randomBytes } from "node:crypto";

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const origins = (
    env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173"
  )
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (production && !env.DATABASE_URL)
    throw new Error("DATABASE_URL is required in production");
  if (
    production &&
    (!env.JWT_SECRET ||
      env.JWT_SECRET.length < 32 ||
      env.JWT_SECRET.includes("replace-this"))
  )
    throw new Error("Set a random JWT_SECRET of at least 32 characters");
  if (production && (!env.CORS_ORIGINS || origins.includes("*")))
    throw new Error("CORS_ORIGINS must list exact frontend origins");
  if (production && (env.CRM_WEBHOOK_URL || env.BPMS_WEBHOOK_URL)) {
    if (!env.WEBHOOK_SECRET || env.WEBHOOK_SECRET.length < 32)
      throw new Error("WEBHOOK_SECRET must have at least 32 characters");
    for (const url of [env.CRM_WEBHOOK_URL, env.BPMS_WEBHOOK_URL].filter(
      Boolean,
    )) {
      if (new URL(url).protocol !== "https:")
        throw new Error("Production webhook URLs must use HTTPS");
    }
  }
  if (env.BITRIX24_WEBHOOK_URL) {
    const url = new URL(env.BITRIX24_WEBHOOK_URL);
    if (production && url.protocol !== "https:")
      throw new Error("Production Bitrix24 webhook URL must use HTTPS");
    if (!/^\/rest\/\d+\/[^/]+\/?$/.test(url.pathname))
      throw new Error(
        "BITRIX24_WEBHOOK_URL must be an incoming REST webhook base URL",
      );
    if (env.CRM_WEBHOOK_URL)
      throw new Error("Use either BITRIX24_WEBHOOK_URL or CRM_WEBHOOK_URL");
  }
  if (
    env.STORAGE_DRIVER === "s3" &&
    ![env.S3_BUCKET, env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY].every(
      Boolean,
    )
  )
    throw new Error("S3 storage configuration is incomplete");
  return {
    production,
    port: Number(env.PORT || 4100),
    databaseUrl: env.DATABASE_URL || "",
    dbMode:
      production || env.DATABASE_URL ? "postgres" : env.DB_MODE || "pglite",
    pglitePath: env.PGLITE_PATH || ".data/postgres",
    jwtSecret: env.JWT_SECRET || randomBytes(48).toString("hex"),
    origins,
    maxUploadBytes: Number(env.MAX_UPLOAD_MB || 20) * 1024 * 1024,
    storageDriver: env.STORAGE_DRIVER || "postgres",
    s3: {
      endpoint: env.S3_ENDPOINT || undefined,
      region: env.S3_REGION || "auto",
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    integrations: {
      resendKey: env.RESEND_API_KEY,
      mailFrom: env.MAIL_FROM,
      crmUrl: env.CRM_WEBHOOK_URL,
      bitrixUrl: env.BITRIX24_WEBHOOK_URL,
      bpmsUrl: env.BPMS_WEBHOOK_URL,
      secret: env.WEBHOOK_SECRET,
    },
  };
}
