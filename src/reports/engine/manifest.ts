import { createHash } from "node:crypto";
import type { Column, Row } from "./csv.js";

export function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export interface FileMeta {
  file: string;
  description: string;
  record_scope: string;
  data_row_count: number | "";
  bytes: number | "";
  sha256: string;
}

export const MANIFEST_COLUMNS: Column[] = [
  { key: "file", header: "file" },
  { key: "description", header: "description" },
  { key: "record_scope", header: "record_scope" },
  { key: "data_row_count", header: "data_row_count" },
  { key: "bytes", header: "bytes" },
  { key: "sha256", header: "sha256" },
  { key: "generated_at", header: "generated_at" },
];

export function manifestRows(metas: FileMeta[], generatedIso: string): Row[] {
  return metas.map((m) => ({ ...m, generated_at: generatedIso }));
}
