import { AppError } from "../errors";
const buckets = new Map<string, { n: number; expires: number }>();
export async function counter(key: string, seconds: number) {
  const url = process.env.UPSTASH_REDIS_REST_URL,
    token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (process.env.NODE_ENV === "production")
      throw new AppError(
        "LIMITER_NOT_CONFIGURED",
        "Planning is temporarily unavailable because production usage protection is not configured.",
        503,
      );
    const now = Date.now(),
      old = buckets.get(key);
    const record =
      old && old.expires > now ? old : { n: 0, expires: now + seconds * 1000 };
    record.n++;
    buckets.set(key, record);
    if (buckets.size > 10000)
      for (const [k, v] of buckets) if (v.expires < now) buckets.delete(k);
    return record.n;
  }
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        "EVAL",
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
        "1",
        `whimway:${key}`,
        String(seconds),
      ]),
    });
    if (!r.ok) throw new Error("Limiter HTTP request failed");
    const data = await r.json();
    if (data.error || typeof data.result !== "number")
      throw new Error("Invalid limiter response");
    return data.result as number;
  } catch {
    throw new AppError(
      "LIMITER_UNAVAILABLE",
      "Usage protection is temporarily unavailable. Please try later.",
      503,
    );
  }
}
