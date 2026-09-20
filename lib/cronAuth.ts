import { timingSafeEqual } from "node:crypto";

// Who may trigger the weekly job. It spends Sentinel Hub quota, Groq tokens and database writes for every
// saved field, so it fails CLOSED: with no CRON_SECRET configured nobody is let in, and a config mistake
// leaves the route locked instead of open. The one exception is a local `next dev` run, so the job can be
// tried by hand without a secret. Vercel Cron sends the secret as "Authorization: Bearer <CRON_SECRET>".
export function isCronAuthorized(
  authorization: string | null,
  env: { CRON_SECRET?: string; NODE_ENV?: string } = process.env
): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return env.NODE_ENV === "development";
  if (!authorization) return false;
  const given = Buffer.from(authorization);
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
