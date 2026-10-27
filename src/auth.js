import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import { one } from "./db.js";
import { ApiError, assert } from "./errors.js";

const scrypt = promisify(scryptCallback);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  try {
    const [kind, salt, hex] = encoded.split(":");
    if (kind !== "scrypt" || !salt || !hex) return false;
    const expected = Buffer.from(hex, "hex");
    const actual = await scrypt(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
export const safeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  roles: user.roles,
  status: user.status,
  createdAt: user.createdAt,
});
export async function issueToken(user, config) {
  return new SignJWT({ version: user.tokenVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer("folio-api")
    .setAudience("folio-web")
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(new TextEncoder().encode(config.jwtSecret));
}
export function authentication(db, config) {
  async function resolve(req) {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(config.jwtSecret),
        { algorithms: ["HS256"], issuer: "folio-api", audience: "folio-web" },
      );
      const user = await one(db, "SELECT * FROM users WHERE id=$1", [
        payload.sub,
      ]);
      if (
        !user ||
        user.status !== "active" ||
        user.tokenVersion !== payload.version
      )
        return null;
      return user;
    } catch {
      return null;
    }
  }
  return {
    optional: async (req, _res, next) => {
      try {
        req.user = await resolve(req);
        next();
      } catch (e) {
        next(e);
      }
    },
    required: async (req, _res, next) => {
      try {
        req.user = await resolve(req);
        if (!req.user)
          throw new ApiError(
            401,
            "Войдите в аккаунт, чтобы продолжить.",
            "UNAUTHENTICATED",
          );
        next();
      } catch (e) {
        next(e);
      }
    },
  };
}
export const isAdmin = (user) => !!user?.roles.includes("admin");
export const requireRole = (role) => (req, _res, next) => {
  try {
    assert(
      req.user && (req.user.roles.includes(role) || isAdmin(req.user)),
      403,
      "Для этого действия нужна другая роль.",
      "FORBIDDEN",
    );
    next();
  } catch (e) {
    next(e);
  }
};
export const owns = (user, ownerId) =>
  user && (user.id === ownerId || isAdmin(user));
