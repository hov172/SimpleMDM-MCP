// run_report_diff MCP tool — compares two local inventory run dirs. Paths are
// restricted to reports/ so the tool is not an arbitrary-file-read primitive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";

const HEAD = "name,serial,os_version,filevault,sip,firewall,supervised,status,device_group,model_name";
const A = "reports/.difftest-before";
const B = "reports/.difftest-after";

function writeRun(dir, rows) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "devices.csv"), [HEAD, ...rows].join("\r\n") + "\r\n");
  writeFileSync(join(dir, "findings.csv"), "type,status,serial,name,detail\r\n");
}

const { handleTool } = await import("../dist/index.js");

test("run_report_diff diffs two runs under reports/ and writes the md", async () => {
  writeRun(A, ["Mac1,S1,14.7,off,on,on,on,enrolled,Lab,MBP"]);
  writeRun(B, ["Mac1,S1,15.6,on,on,on,on,enrolled,Lab,MBP"]);
  try {
    const r = await handleTool("run_report_diff", { before_dir: A, after_dir: B });
    assert.equal(r.changed.length, 1);
    assert.equal(r.changed[0].serial, "S1");
    assert.ok(r.markdown.includes("os_version 14.7 → 15.6"));
    assert.ok(existsSync(join(B, "diff-vs-.difftest-before.md")), "diff md written into after dir");
  } finally { rmSync(A, { recursive: true, force: true }); rmSync(B, { recursive: true, force: true }); }
});

test("run_report_diff rejects paths outside reports/", async () => {
  await assert.rejects(
    () => handleTool("run_report_diff", { before_dir: "/etc", after_dir: B }),
    /reports\//,
    "must not read arbitrary directories",
  );
  await assert.rejects(
    () => handleTool("run_report_diff", { before_dir: "reports/../src", after_dir: B }),
    /reports\//,
    "traversal out of reports/ must be rejected",
  );
});
