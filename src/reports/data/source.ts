import type { DeviceRecord } from "../domain/inventory.js";
import type { EvaluatedDevice } from "../domain/sofa-eval.js";

export type Scope =
  | { kind: "serials"; value: string[] }
  | { kind: "group"; value: string }
  | { kind: "lastSeen"; value: number }
  | { kind: "all" }
  | { kind: "search"; value: string };

export interface DataSource {
  devices(scope?: Scope): Promise<DeviceRecord[]>;
  apps(scope?: Scope): Promise<any[]>;
  profiles(scope?: Scope): Promise<any[]>;
  users(scope?: Scope): Promise<any[]>;
  logs(scope: Scope, opts?: { pages?: number }): Promise<any[]>;
  securityPosture(scope?: Scope): Promise<EvaluatedDevice[]>;
}
