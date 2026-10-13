import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { createHttpApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { AlexaSimulator } from "../src/alexa/simulator.js";
import { makeCare } from "./helpers.js";

async function withServer(fn: (base: string, token: string) => Promise<void>) {
  const token = "test-token";
  const config = { ...loadConfig(), mcpAuthToken: token, host: "127.0.0.1" };
  const { care, setTime } = makeCare();
  setTime("08:30");
  const server = createHttpApp(config, care).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn(base, token);
  } finally {
    server.close();
  }
}

test("speaks MCP 2025-11-25 over Streamable HTTP and exposes all tools", async () => {
  assert.equal(LATEST_PROTOCOL_VERSION, "2025-11-25");
  await withServer(async (base, token) => {
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "add_reminder", "check_missed", "get_status", "get_timeline", "list_today", "log_checkin", "notify_family", "weekly_summary",
    ]);
    const added = await client.callTool({ name: "add_reminder", arguments: { kind: "medication", title: "Metformin", daily_time: "08:00" } });
    assert.match(JSON.stringify(added.content), /Metformin every day at 8 AM/);
    await client.callTool({ name: "log_checkin", arguments: { kind: "medication", text: "took my pills" } });
    const today = await client.callTool({ name: "list_today", arguments: {} });
    assert.match(JSON.stringify(today.content), /All of today's medications are taken/);
    await client.close();
  });
});

test("rejects requests without the bearer token", async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
    assert.equal(res.status, 401);
  });
});

test("the simulated Alexa calls the server over MCP", async () => {
  await withServer(async (base, token) => {
    const alexa = new AlexaSimulator({
      mcpUrl: `${base}/mcp`, authToken: token, parentName: "Mom", timeZone: "America/Toronto",
      brain: "rules", bedrockModel: "", awsRegion: "us-east-1",
    });
    const turn = await alexa.handle("Had my oatmeal and the little white pill");
    assert.deepEqual(turn.trace.map((t) => t.tool), ["log_checkin", "log_checkin"]);
    assert.match(turn.reply, /logged your medication and meal/);
    const status = await alexa.handle("How's Mom today?", "Sarah");
    assert.match(status.reply, /first checked in/);
  });
});
