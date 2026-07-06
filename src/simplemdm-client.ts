// SimpleMDM HTTP client — shared between src/index.ts and the report data layer.

const BASE = "https://a.simplemdm.com/api/v1";
export const API_KEY = process.env.SIMPLEMDM_API_KEY ?? "";
const AUTH_HEADER = API_KEY ? `Basic ${Buffer.from(`${API_KEY}:`).toString("base64")}` : "";
const REQUEST_TIMEOUT_MS = Number(process.env.SIMPLEMDM_TIMEOUT_MS ?? 30_000);
const MAX_RETRIES = Number(process.env.SIMPLEMDM_MAX_RETRIES ?? 3);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(readonly upstream: string, readonly status: number, readonly bodyExcerpt: string) {
    super(`${upstream} ${status}`);
  }
}

export async function fetchWithRetry(upstream: string, url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      // Retry 429 and 5xx with Retry-After / exponential backoff.
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(1000 * 2 ** attempt, 10_000);
        await sleep(delayMs);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt >= MAX_RETRIES) break;
      await sleep(Math.min(1000 * 2 ** attempt, 10_000));
    }
  }
  throw new Error(`${upstream} request failed after ${MAX_RETRIES + 1} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

export async function throwForStatus(upstream: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  // Cap body excerpt to avoid leaking large upstream payloads into client errors.
  const excerpt = body.slice(0, 500);
  throw new HttpError(upstream, res.status, excerpt);
}

export async function simpleMDM(path: string, opts: RequestInit = {}): Promise<unknown> {
  // Fail fast with the actual cause. Startup permits a missing key in
  // LOCAL_APP_MODE, but only the two local-app tools work without one — every
  // other tool lands here and would otherwise surface an opaque upstream 401.
  if (!API_KEY) {
    throw new Error(
      "SIMPLEMDM_API_KEY is not set. This tool requires direct SimpleMDM API access; " +
      "LOCAL_APP_MODE only serves get_fleet_summary and get_security_posture without an API key.",
    );
  }
  const headers: Record<string, string> = {
    Authorization: AUTH_HEADER,
    ...(opts.headers as Record<string, string> ?? {}),
  };
  if (opts.body != null) headers["Content-Type"] = "application/json";
  const res = await fetchWithRetry("SimpleMDM", `${BASE}${path}`, { ...opts, headers });
  if (!res.ok) await throwForStatus("SimpleMDM", res);
  if (res.status === 204) return { success: true };
  return res.json();
}
