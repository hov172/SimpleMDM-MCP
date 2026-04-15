// localAppClient.ts
// Talks to the running Report-SimpleMDM app on localhost instead of
// hitting the SimpleMDM API directly. Only used when LOCAL_APP_MODE=true.

const LOCAL_APP_BASE  = process.env.LOCAL_APP_BASE_URL ?? "http://127.0.0.1:49552";
const LOCAL_APP_TOKEN = process.env.LOCAL_APP_TOKEN ?? "";

export async function localApp(path: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${LOCAL_APP_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${LOCAL_APP_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Local app ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

export async function checkLocalApp(): Promise<void> {
  if (!LOCAL_APP_TOKEN) {
    console.error("ERROR: LOCAL_APP_TOKEN is required when LOCAL_APP_MODE=true.\nGet the token from Report-SimpleMDM > Settings > Developer > Local API.");
    process.exit(1);
  }
  try {
    const res = await fetch(`${LOCAL_APP_BASE}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { status: string; connected: boolean };
    if (!data.connected) {
      console.error("Warning: Report-SimpleMDM local API is running but not connected to SimpleMDM.");
    }
  } catch (err) {
    console.error(
      `ERROR: Could not reach Report-SimpleMDM at ${LOCAL_APP_BASE}.\n` +
      "Make sure the app is open and Settings > Developer > Enable Local API is turned on.\n" +
      err
    );
    process.exit(1);
  }
}
