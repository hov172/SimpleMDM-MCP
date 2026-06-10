import { test } from "node:test";
import assert from "node:assert/strict";

// Set test mode env var so dist/index.js bypasses server setup and Stdio transport
process.env.SIMPLEMDM_TEST_MODE = "true";
process.env.SIMPLEMDM_API_KEY = "dummy-key";
process.env.SIMPLEMDM_ALLOW_WRITES = "true";

// Interceptor for global fetch
const fetchHistory = [];
const mockRoutes = new Map();

globalThis.fetch = async (url, opts) => {
  const parsedUrl = new URL(url);
  const path = parsedUrl.pathname;
  const method = opts?.method ?? "GET";
  
  fetchHistory.push({ method, url, body: opts?.body });

  const routeKey = `${method}:${path}`;
  if (mockRoutes.has(routeKey)) {
    const handler = mockRoutes.get(routeKey);
    const responseData = typeof handler === "function" ? handler(parsedUrl, opts) : handler;
    
    return {
      ok: true,
      status: responseData.status ?? 200,
      json: async () => responseData.body,
      text: async () => JSON.stringify(responseData.body)
    };
  }

  throw new Error(`Unhandled mock fetch request: ${method} ${url}`);
};

// Import handleTool after fetch is mocked
const { handleTool } = await import("../dist/index.js");

test("get_certificate_expiration_audit calculates days to expiration", async () => {
  // Set expiration date to exactly 10 days in the future (plus safety padding to avoid rounding down)
  const expiresAt = new Date(Date.now() + 10 * 86_400_000 + 60_000).toISOString();
  
  mockRoutes.set("GET:/api/v1/push_certificate", {
    body: {
      data: {
        attributes: {
          apple_id: "test@apple.com",
          expires_at: expiresAt
        }
      }
    }
  });

  const result = await handleTool("get_certificate_expiration_audit", {});
  assert.equal(result.apple_id, "test@apple.com");
  assert.equal(result.expires_at, expiresAt);
  assert.equal(result.days_until_expiry, 10);
  assert.equal(result.warning, "renew_now");
});

test("verify_webhook_payload checks schema fields correctly", async () => {
  // Valid payload
  const validResult = await handleTool("verify_webhook_payload", {
    payload: JSON.stringify({
      event: "device.enrolled",
      data: {
        device_id: "123",
        device_name: "Macbook Air",
        serial_number: "C02XYZ"
      }
    })
  });
  assert.equal(validResult.valid, true);
  assert.equal(validResult.event, "device.enrolled");

  // Invalid payload (missing serial_number)
  const invalidResult = await handleTool("verify_webhook_payload", {
    payload: JSON.stringify({
      event: "device.enrolled",
      data: {
        device_id: "123",
        device_name: "Macbook Air"
      }
    })
  });
  assert.equal(invalidResult.valid, false);
  assert.match(invalidResult.error, /Missing expected fields/);
});

test("get_dep_device_status iterates dep servers and retrieves matching serial", async () => {
  mockRoutes.set("GET:/api/v1/dep_servers", {
    body: {
      data: [
        { id: "10", attributes: { name: "Corporate ABM" } }
      ],
      has_more: false
    }
  });

  mockRoutes.set("GET:/api/v1/dep_servers/10/dep_devices", {
    body: {
      data: [
        {
          id: "100",
          attributes: {
            serial_number: "C02XYZ123ABC",
            model: "MacBookPro18,1",
            profile_status: "assigned"
          }
        }
      ],
      has_more: false
    }
  });

  const result = await handleTool("get_dep_device_status", { serial_number: "C02XYZ123ABC" });
  assert.equal(result.found, true);
  assert.equal(result.dep_server.name, "Corporate ABM");
  assert.equal(result.device.serial_number, "C02XYZ123ABC");
  assert.equal(result.device.model, "MacBookPro18,1");

  const missingResult = await handleTool("get_dep_device_status", { serial_number: "NOTFOUND" });
  assert.equal(missingResult.found, false);
});

test("get_managed_app_config_templates returns enterprise app config templates", async () => {
  const result = await handleTool("get_managed_app_config_templates", {});
  assert.ok(result.templates.chrome);
  assert.ok(result.templates.zoom);
  assert.ok(result.templates.teams);
  assert.equal(result.templates.chrome.app_name, "Google Chrome");
});

test("set_managed_app_config_schema diffs and updates app configurations", async () => {
  fetchHistory.length = 0; // Clear history
  
  mockRoutes.set("GET:/api/v1/apps/12/managed_configs", {
    body: {
      data: [
        {
          id: "500",
          attributes: {
            key: "HomepageLocation",
            value: "https://www.google.com",
            kind: "string"
          }
        },
        {
          id: "501",
          attributes: {
            key: "BookmarkBarEnabled",
            value: true,
            kind: "boolean"
          }
        }
      ],
      has_more: false
    }
  });

  mockRoutes.set("DELETE:/api/v1/apps/12/managed_configs/501", {
    status: 204,
    body: { success: true }
  });

  mockRoutes.set("POST:/api/v1/apps/12/managed_configs", {
    status: 201,
    body: { success: true }
  });

  mockRoutes.set("POST:/api/v1/apps/12/managed_configs/push", {
    status: 204,
    body: { success: true }
  });

  // Execute set_managed_app_config_schema with updated BookmarkBarEnabled and new ShowHomeButton
  const result = await handleTool("set_managed_app_config_schema", {
    app_id: "12",
    config: {
      HomepageLocation: "https://www.google.com", // unchanged
      BookmarkBarEnabled: false, // changed from true
      ShowHomeButton: true // new
    }
  });

  assert.equal(result.success, true);
  
  // Verify expected DELETE call for key BookmarkBarEnabled (id: 501)
  const deleteCalls = fetchHistory.filter(f => f.method === "DELETE");
  assert.equal(deleteCalls.length, 1);
  assert.match(deleteCalls[0].url, /\/managed_configs\/501$/);

  // Verify expected POST calls to create BookmarkBarEnabled (new value false) and ShowHomeButton
  const postCreateCalls = fetchHistory.filter(f => f.method === "POST" && !f.url.endsWith("/push"));
  assert.equal(postCreateCalls.length, 2);
  
  const createdKeys = postCreateCalls.map(f => JSON.parse(f.body).key);
  assert.ok(createdKeys.includes("BookmarkBarEnabled"));
  assert.ok(createdKeys.includes("ShowHomeButton"));

  // Verify expected push call
  const pushCalls = fetchHistory.filter(f => f.method === "POST" && f.url.endsWith("/push"));
  assert.equal(pushCalls.length, 1);
});
