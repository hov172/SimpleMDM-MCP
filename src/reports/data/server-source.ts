import type { DataSource, Scope } from "./source.js";
import type { DeviceRecord } from "../domain/inventory.js";
import type { EvaluatedDevice } from "../domain/sofa-eval.js";
import { normalizeDevice } from "../domain/inventory.js";
import { buildMajorTables, evaluateDevice } from "../domain/sofa-eval.js";

export type ClientFn = (path: string, opts?: RequestInit) => Promise<unknown>;

export type FetchJsonFn = (url: string) => Promise<unknown>;

const defaultFetchJson: FetchJsonFn = (url) => fetch(url).then((r) => r.json());

export class ServerDataSource implements DataSource {
  private readonly fetchJson: FetchJsonFn;

  constructor(
    private readonly client: ClientFn,
    private readonly maxPages = 200,
    fetchJson?: FetchJsonFn,
    // Optional cached raw-/devices fetcher. When the MCP server injects its
    // write-invalidated collectDevices(), back-to-back reports reuse the cached
    // fleet instead of re-paginating /devices on every run. Omitted → paginateAll.
    private readonly deviceFetcher?: () => Promise<any[]>,
  ) {
    this.fetchJson = fetchJson ?? defaultFetchJson;
  }

  private async paginateAll(path: string): Promise<any[]> {
    const out: any[] = [];
    let cursor: string | number | undefined;
    for (let page = 0; page < this.maxPages; page++) {
      const q = cursor != null ? `&starting_after=${encodeURIComponent(String(cursor))}` : "";
      const res = (await this.client(`${path}?limit=100${q}`)) as { data?: any[]; has_more?: boolean };
      const items = Array.isArray(res?.data) ? res.data : [];
      out.push(...items);
      if (!res.has_more) return out;
      cursor = items.at(-1)?.id;
      if (cursor == null) return out;
    }
    throw new Error(`paginateAll(${path}): exceeded ${this.maxPages}-page cap`);
  }

  // NOTE: scope filtering is DEVICE-RECORD shaped — it keys off serial / device_group /
  // seen_at, which only exist on device records. apps()/profiles()/users()/logs() results
  // do not carry those fields, so a non-"all" scope would filter them all out. Today every
  // non-device caller passes scope "all"/undefined (dynamic mode fetches unscoped), so this
  // is a no-op for them; narrowing those adapters by device scope needs a join, not added here.
  private applyScope(records: any[], scope?: Scope): any[] {
    if (!scope || scope.kind === "all") return records;
    if (scope.kind === "serials") {
      const vals = new Set(scope.value);
      return records.filter((r: any) => {
        const serial: string = r.serial ?? r.attributes?.serial_number ?? "";
        return vals.has(serial);
      });
    }
    if (scope.kind === "group") {
      return records.filter((r: any) => {
        const dg: string = r.device_group ?? r.attributes?.device_group_name ?? "";
        return dg === scope.value;
      });
    }
    if (scope.kind === "lastSeen") {
      const cutoff = new Date(Date.now() - scope.value * 86_400_000).toISOString();
      return records.filter((r: any) => {
        const seen: string | undefined = r.seen_at ?? r.attributes?.last_seen_at;
        return seen != null && seen >= cutoff;
      });
    }
    if (scope.kind === "search") {
      const q = scope.value.toLowerCase();
      return records.filter((r: any) => {
        const serial = (r.serial ?? r.attributes?.serial_number ?? "").toLowerCase();
        const name = (r.name ?? r.attributes?.name ?? "").toLowerCase();
        return serial.includes(q) || name.includes(q);
      });
    }
    return records;
  }

  // Build an id→name map from a group list endpoint. Best-effort: a failed fetch
  // yields an empty map (blank group names) rather than failing the whole report.
  private async groupNameMap(path: string): Promise<Map<number | string, string>> {
    try {
      const rows = await this.paginateAll(path);
      return new Map(rows.map((g: any) => [g.id, g.attributes?.name ?? String(g.id)]));
    } catch {
      return new Map();
    }
  }

  async devices(scope?: Scope): Promise<DeviceRecord[]> {
    const raw = this.deviceFetcher ? await this.deviceFetcher() : await this.paginateAll("/devices");
    // Resolve group ids → names so device_group / assignment_groups render real names
    // (e.g. "HLAB_Faculty") instead of blanks — parity with the inventory bridge.
    const [dgMap, agNames] = await Promise.all([
      this.groupNameMap("/device_groups"),
      this.groupNameMap("/assignment_groups"),
    ]);
    const filtered = this.applyScope(raw, scope);
    // Attach the original raw API object so dynamic-report filters can reach any
    // SimpleMDM device field via `raw.attributes.<field>`, not just normalized keys.
    return filtered.map((d: any) => ({ ...normalizeDevice(d, { dgMap, agNames }), raw: d }));
  }

  async apps(scope?: Scope): Promise<any[]> {
    const raw = await this.paginateAll("/apps");
    return this.applyScope(raw, scope);
  }

  async profiles(scope?: Scope): Promise<any[]> {
    const raw = await this.paginateAll("/profiles");
    return this.applyScope(raw, scope);
  }

  async users(scope?: Scope): Promise<any[]> {
    const raw = await this.paginateAll("/users");
    return this.applyScope(raw, scope);
  }

  async logs(scope: Scope, opts?: { pages?: number }): Promise<any[]> {
    const maxP = opts?.pages ?? this.maxPages;
    const out: any[] = [];
    let cursor: string | number | undefined;
    let completed = false;
    for (let page = 0; page < maxP; page++) {
      const q = cursor != null ? `&starting_after=${encodeURIComponent(String(cursor))}` : "";
      const res = (await this.client(`/logs?limit=100${q}`)) as { data?: any[]; has_more?: boolean };
      const items = Array.isArray(res?.data) ? res.data : [];
      out.push(...items);
      if (!res.has_more) { completed = true; break; }
      cursor = items.at(-1)?.id;
      if (cursor == null) { completed = true; break; }
    }
    // Forensic/legal export: never return a silently-truncated log set. If the cap is
    // hit while the API still reports has_more, fail loudly (mirrors paginateAll).
    if (!completed) {
      throw new Error(`logs(): exceeded ${maxP}-page cap with more pages pending; narrow the scope or raise pages`);
    }
    return this.applyScope(out, scope);
  }

  async securityPosture(scope?: Scope): Promise<EvaluatedDevice[]> {
    const SOFA_MAC = "https://sofafeed.macadmins.io/v1/macos_data_feed.json";
    const SOFA_IOS = "https://sofafeed.macadmins.io/v1/ios_data_feed.json";
    const [macFeed, iosFeed] = await Promise.all([
      this.fetchJson(SOFA_MAC),
      this.fetchJson(SOFA_IOS),
    ]);
    const tables = buildMajorTables(macFeed as any, iosFeed as any);
    const devs = await this.devices(scope);
    return devs.map((d) => evaluateDevice(d as unknown as Record<string, unknown>, tables));
  }
}
