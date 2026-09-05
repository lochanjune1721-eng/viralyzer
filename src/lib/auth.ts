import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { createUser, getUser } from "@/lib/db/repo";
import type { User } from "@/lib/types";

// v1 auth: a signed cookie identifies a local user record. There is no password;
// the first visit creates the user and onboarding collects name + niche.
const COOKIE = "vz_uid";

function sign(value: string): string {
  return createHmac("sha256", env.appSecret).update(value).digest("base64url");
}

function verify(token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig) return null;
  const expected = sign(id);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export async function getCurrentUser(): Promise<User> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  const id = token ? verify(token) : null;
  if (id) {
    const user = getUser(id);
    if (user) return user;
  }
  const user = createUser();
  try {
    jar.set(COOKIE, `${user.id}.${sign(user.id)}`, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  } catch {
    // cookies() is read-only in server components; the API layer sets it instead.
  }
  return user;
}

export function userIdFromCookieValue(value: string | undefined): string | null {
  return value ? verify(value) : null;
}
