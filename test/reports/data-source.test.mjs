import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sampleRaw = JSON.parse(
  readFileSync(resolve(__dirname, "../fixtures/devices-sample.json"), "utf8"),
);
// devices-sample.json is wrapped: { data: [...], has_more: false }
const rawDevices = sampleRaw.data ?? sampleRaw;

function makeMockClient(devicesData) {
  return async (path) => {
    if (path.startsWith("/devices")) {
      return { data: devicesData, has_more: false };
    }
    return { data: [], has_more: false };
  };
}

function makeSpyClient(calls) {
  return async (path) => {
    calls.push(path);
    return { data: [], has_more: false };
  };
}

const { ServerDataSource } = await import("../../dist/reports/data/server-source.js");

test("ServerDataSource.devices resolves a serials scope", async () => {
  const ds = new ServerDataSource(makeMockClient(rawDevices));
  const devs = await ds.devices({ kind: "serials", value: ["C02AAA111"] });
  assert.equal(devs.length, 1);
  assert.equal(devs[0].serial, "C02AAA111");
});

test("ServerDataSource.devices with all scope returns all devices", async () => {
  const ds = new ServerDataSource(makeMockClient(rawDevices));
  const devs = await ds.devices({ kind: "all" });
  assert.ok(devs.length > 0);
});

test("no report fetch path calls a mutating client method", async () => {
  const calls = [];
  const ds = new ServerDataSource(makeSpyClient(calls));
  await ds.devices({ kind: "all" }).catch(() => {});
  assert.equal(
    calls.some((m) => /create|update|delete|push|wipe|lock|post|put|patch/i.test(m)),
    false,
    `Mutating call detected: ${calls.join(", ")}`,
  );
});
