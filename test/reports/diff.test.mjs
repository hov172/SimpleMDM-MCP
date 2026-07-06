// Report diff — the reason the same report gets re-run (missing-filevault 6x in
// one day) is to see WHAT CHANGED; this compares two inventory run dirs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HEAD = "name,serial,os_version,filevault,sip,firewall,supervised,status,device_group,model_name,seen_at,storage_free_gb";
const FINDINGS_HEAD = "type,status,serial,name,detail";

function makeRun(devices, findings) {
  const dir = mkdtempSync(join(tmpdir(), "diff-run-"));
  writeFileSync(join(dir, "devices.csv"), [HEAD, ...devices].join("\r\n") + "\r\n");
  writeFileSync(join(dir, "findings.csv"), [FINDINGS_HEAD, ...findings].join("\r\n") + "\r\n");
  return dir;
}

const { diffInventoryRuns, renderDiffMarkdown } = await import("../../dist/reports/domain/diff.js");

test("diffInventoryRuns reports added/removed devices, field changes, findings delta", () => {
  const before = makeRun(
    [
      'Alice MBP,C02A,14.7.1,off,on,on,on,enrolled,Faculty,"MacBook Pro",2026-06-01T10:00:00Z,100.5',
      'Old iMac,C02B,15.5,on,on,on,on,enrolled,Lab,"iMac",2026-06-01T09:00:00Z,50',
    ],
    [
      "device-stale,flag,C02A,Alice MBP,not seen in 30d",
      "recoverykey-missing,flag,C02B,Old iMac,FileVault on but no escrowed key",
    ],
  );
  const after = makeRun(
    [
      // C02A: os upgraded AND FileVault turned on; seen_at/storage changed (volatile — ignored)
      'Alice MBP,C02A,15.6.1,on,on,on,on,enrolled,Faculty,"MacBook Pro",2026-06-26T10:00:00Z,90.1',
      // C02B removed; C02C added
      'New Mini,C02C,15.6.1,on,on,on,on,enrolled,Lab,"Mac mini",2026-06-26T09:00:00Z,400',
    ],
    [
      "device-stale,flag,C02A,Alice MBP,not seen in 30d", // persists
      "low-storage,flag,C02C,New Mini,under 16GB free",   // new
      // recoverykey-missing resolved (C02B gone)
    ],
  );
  try {
    const d = diffInventoryRuns(before, after);
    assert.deepEqual(d.devicesAdded.map((x) => x.serial), ["C02C"]);
    assert.deepEqual(d.devicesRemoved.map((x) => x.serial), ["C02B"]);
    assert.equal(d.changed.length, 1);
    assert.equal(d.changed[0].serial, "C02A");
    const fields = d.changed[0].changes.map((c) => c.field).sort();
    assert.deepEqual(fields, ["filevault", "os_version"], `volatile fields must be ignored; got ${fields}`);
    const fv = d.changed[0].changes.find((c) => c.field === "filevault");
    assert.equal(fv.from, "off"); assert.equal(fv.to, "on");

    assert.equal(d.findingsNew.length, 1);
    assert.equal(d.findingsNew[0].type, "low-storage");
    assert.equal(d.findingsResolved.length, 1);
    assert.equal(d.findingsResolved[0].type, "recoverykey-missing");

    const md = renderDiffMarkdown(d, before, after);
    assert.match(md, /C02C/, "markdown mentions added device");
    assert.match(md, /filevault.*off.*on|off\s*→\s*on/i, "markdown shows the FileVault flip");
  } finally { rmSync(before, { recursive: true, force: true }); rmSync(after, { recursive: true, force: true }); }
});

test("diffInventoryRuns handles quoted CSV values with commas", () => {
  const a = makeRun(['X,S1,15.5,on,on,on,on,enrolled,"Design, Theater","MacBook Pro (16-inch, 2021)",t,1'], []);
  const b = makeRun(['X,S1,15.5,on,on,on,on,enrolled,"Design, Theater","MacBook Pro (16-inch, 2021)",t,1'], []);
  try {
    const d = diffInventoryRuns(a, b);
    assert.equal(d.changed.length, 0, "identical rows with quoted commas must not diff");
    assert.equal(d.devicesAdded.length + d.devicesRemoved.length, 0);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

// ── CLI + MCP wiring ───────────────────────────────────────────────────────────

test("runCli diff subcommand writes a diff markdown next to the after-run", async () => {
  const a = makeRun(['X,S1,15.5,on,on,on,on,enrolled,G,"M",t,1'], []);
  const b = makeRun(['X,S1,15.6,on,on,on,on,enrolled,G,"M",t,1'], []);
  try {
    const { runCli } = await import("../../dist/reports/cli.js");
    const result = await runCli(["diff", a, b]);
    const { readFileSync, existsSync } = await import("node:fs");
    const outFile = result.files.find((f) => /diff/.test(f.name));
    assert.ok(outFile, "must report the diff file it wrote");
    const full = join(b, outFile.name);
    assert.ok(existsSync(full), `diff md must exist at ${full}`);
    assert.match(readFileSync(full, "utf8"), /os_version 15\.5 → 15\.6/);
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});
