// localAppClient.ts
// Talks to the running Report-SimpleMDM app on localhost instead of
// hitting the SimpleMDM API directly. Only used when LOCAL_APP_MODE=true.

const LOCAL_APP_BASE  = process.env.LOCAL_APP_BASE_URL ?? "http://127.0.0.1:49552";
const LOCAL_APP_TOKEN = process.env.LOCAL_APP_TOKEN ?? "";
const TIMEOUT_MS      = Number(process.env.LOCAL_APP_TIMEOUT_MS ?? 15_000);

export async function localApp(path: string, options: RequestInit = {}): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${LOCAL_APP_TOKEN}`,
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (options.body != null) headers["Content-Type"] = "application/json";
  const res = await fetch(`${LOCAL_APP_BASE}${path}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Local app ${res.status} on ${path}: ${body.slice(0, 500)}`);
  }
  if (res.status === 204) return { success: true };
  return res.json();
}

// Throws on misconfiguration or connectivity problems. Callers (the main
// entrypoint) decide how to surface the failure — no process.exit here.
export async function checkLocalApp(): Promise<void> {
  if (!LOCAL_APP_TOKEN) {
    throw new Error(
      "LOCAL_APP_TOKEN is required when LOCAL_APP_MODE=true. " +
      "Get the token from Report-SimpleMDM > Settings > Developer > Local API."
    );
  }
  let data: { status?: string; connected?: boolean };
  try {
    const res = await fetch(`${LOCAL_APP_BASE}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json() as { status: string; connected: boolean };
  } catch (err) {
    throw new Error(
      `Could not reach Report-SimpleMDM at ${LOCAL_APP_BASE}. ` +
      "Make sure the app is open and Settings > Developer > Enable Local API is turned on. " +
      `(${err instanceof Error ? err.message : String(err)})`
    );
  }
  if (!data.connected) {
    console.error("Warning: Report-SimpleMDM local API is running but not connected to SimpleMDM.");
  }
}
