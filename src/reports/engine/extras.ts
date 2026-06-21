import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

// scripts/ ships alongside the engine (copied into the image); resolve from this module.
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts");

export interface ExtraFile { name: string; description: string }
export interface ExtrasResult {
  files: ExtraFile[];
  skipped: { artifact: string; reason: string }[];
}

// Recursively list files under dir, as paths relative to dir, excluding the given names.
function listFiles(dir: string, exclude: (rel: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const rel = relative(dir, full);
        if (!exclude(rel)) out.push(rel);
      }
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Write the always-on bundle artifacts for a completed report directory:
 *   - manifest.sha256  : sha256sum-format integrity list of every deliverable (pure Node)
 *   - report-table.xlsx: Excel twin of report-table.csv when present (python3, best-effort)
 *   - <dir>.zip        : single archive of the whole report (python3, best-effort)
 *
 * Best-effort: a missing python3 (or any failure) skips that artifact, exactly like the
 * pdf/docx pipeline. Applies to ANY report — call after dossier.write() on every path.
 */
export function writeReportExtras(outDir: string): ExtrasResult {
  const files: ExtraFile[] = [];
  const skipped: { artifact: string; reason: string }[] = [];
  const zipName = `${basename(outDir.replace(/\/+$/, ""))}.zip`;

  // 1. report-table.xlsx (only when a report-table.csv exists — flat/roster inventory).
  if (existsSync(join(outDir, "report-table.csv"))) {
    try {
      execFileSync("python3", [join(SCRIPTS, "csv-to-xlsx.py"), join(outDir, "report-table.csv"), join(outDir, "report-table.xlsx")], { stdio: "pipe" });
      files.push({ name: "report-table.xlsx", description: "Excel workbook of the report table" });
    } catch (e) {
      skipped.push({ artifact: "report-table.xlsx", reason: (e as Error).message });
    }
  }

  // 2. manifest.sha256 — hash every file except itself and the bundle zip (pure Node, always available).
  try {
    const rels = listFiles(outDir, (rel) => rel === "manifest.sha256" || rel === zipName);
    const lines = rels.map((rel) => {
      const hash = createHash("sha256").update(readFileSync(join(outDir, rel))).digest("hex");
      return `${hash}  ${rel}`;
    });
    writeFileSync(join(outDir, "manifest.sha256"), lines.join("\n") + "\n");
    files.push({ name: "manifest.sha256", description: "SHA-256 integrity manifest (sha256sum format)" });
  } catch (e) {
    skipped.push({ artifact: "manifest.sha256", reason: (e as Error).message });
  }

  // 3. <dir>.zip — single archive of the whole report directory (python3, best-effort).
  try {
    execFileSync("python3", [join(SCRIPTS, "bundle-zip.py"), outDir, zipName], { stdio: "pipe" });
    files.push({ name: zipName, description: "Zip archive of the full report" });
  } catch (e) {
    skipped.push({ artifact: zipName, reason: (e as Error).message });
  }

  return { files, skipped };
}
