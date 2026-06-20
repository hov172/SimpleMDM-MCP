import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sha256, type FileMeta } from "./manifest.js";

export interface WrittenFile {
  name: string;
  description: string;
  rows: number | null;
  sha256: string;
  bytes: number;
}

export function writeArtifact(
  outDir: string,
  name: string,
  body: string,
  description: string,
  rows: number | null,
): WrittenFile {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, name), body);
  const bytes = Buffer.byteLength(body);
  return { name, description, rows, sha256: sha256(body), bytes };
}

export function toFileMeta(w: WrittenFile): FileMeta {
  return {
    file: w.name,
    description: w.description,
    record_scope: "",
    data_row_count: w.rows ?? "",
    bytes: w.bytes,
    sha256: w.sha256,
  };
}
