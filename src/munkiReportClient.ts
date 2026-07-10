import { API_KEY, fetchWithRetry, throwForStatus } from "./simplemdm-client.js";

export const MR_BASE   = process.env.MUNKIREPORT_BASE_URL ?? "";
export const MR_PREFIX = process.env.MUNKIREPORT_MODULE_PREFIX ?? "/module/simplemdm";

// Token-authenticated POST to the module's sync-token ingest endpoints. The
// X-SimpleMDM-API-Key header is sent ONLY here — never on session reads — to
// keep key exposure limited to the endpoint class designed to receive it.
export async function munkiReportIngest(route: string, body: unknown): Promise<unknown> {
  if (!MR_BASE) throw new Error("MunkiReport not configured — set MUNKIREPORT_BASE_URL.");
  const res = await fetchWithRetry("MunkiReport", `${MR_BASE}${MR_PREFIX}${route}`, {
    method: "POST",
    headers: { "X-SimpleMDM-API-Key": API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwForStatus("MunkiReport", res);
  return res.json();
}
