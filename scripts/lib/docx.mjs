import { spawnSync } from "node:child_process";

export function hasPandoc() {
  return spawnSync("pandoc", ["--version"], { stdio: "ignore" }).status === 0;
}

// Convert a Markdown file to .docx. Returns true on success, false if pandoc missing/failed.
export function mdToDocx(mdPath, docxPath) {
  if (!hasPandoc()) {
    console.warn("WARN: pandoc not found — skipping .docx export");
    return false;
  }
  const res = spawnSync("pandoc", [mdPath, "-o", docxPath], { stdio: "inherit" });
  return res.status === 0;
}
