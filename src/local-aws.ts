// `npm run aws:local`: runs CareCircle against an emulated AWS stack on your machine,
// for when you have no AWS account (or one that blocks these services).
//
//   DynamoDB     -> dynalite, a DynamoDB-compatible server (data kept in data/dynamodb)
//   Lambda + URL -> the real Lambda handler (src/lambda/mcp.ts) behind a local Function URL
//   EventBridge  -> the real checker handler (src/lambda/checker.ts) on a timer
//   SNS          -> alerts printed to this log and shown on the dashboard
//
// The simulated Alexa on the dashboard calls the emulated Function URL, so every request
// takes the same code path it would on AWS. Pass --seed to reload the demo week.
import { createServer, type IncomingMessage } from "node:http";
import { mkdirSync } from "node:fs";
import { CreateTableCommand, DeleteTableCommand, DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import dynalite from "dynalite";
import { record } from "./activity.js";

const DDB_PORT = Number(process.env.DDB_PORT ?? "8000");
const LAMBDA_PORT = Number(process.env.LAMBDA_PORT ?? "3001");
const SCHEDULE_MINUTES = Number(process.env.SCHEDULE_MINUTES ?? "1");
const DATA_DIR = "data/dynamodb";

// Point the AWS SDK at the emulators before any CareCircle module reads its config.
Object.assign(process.env, {
  STORE: "dynamodb",
  TABLE_NAME: process.env.TABLE_NAME ?? "CareCircle",
  AWS_REGION: process.env.AWS_REGION ?? "us-east-1",
  AWS_ENDPOINT_URL_DYNAMODB: `http://127.0.0.1:${DDB_PORT}`,
  AWS_ACCESS_KEY_ID: "local",
  AWS_SECRET_ACCESS_KEY: "local",
  NOTIFIER: "console",
});
delete process.env.AWS_PROFILE;
delete process.env.AWS_SESSION_TOKEN;

const tableName = process.env.TABLE_NAME!;

async function startDynamo(): Promise<void> {
  mkdirSync(DATA_DIR, { recursive: true });
  const server = dynalite({ path: DATA_DIR, createTableMs: 0, deleteTableMs: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(DDB_PORT, "127.0.0.1", () => resolve());
  });
}

/** Creates the same table the CDK stack defines (recreated empty when `reset`). Returns true if it was new. */
async function ensureTable(reset: boolean): Promise<boolean> {
  const ddb = new DynamoDBClient({});
  try {
    await ddb.send(new DescribeTableCommand({ TableName: tableName }));
    if (!reset) return false;
    await ddb.send(new DeleteTableCommand({ TableName: tableName }));
    throw new Error("recreate");
  } catch {
    await ddb.send(
      new CreateTableCommand({
        TableName: tableName,
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        BillingMode: "PAY_PER_REQUEST",
      }),
    );
    return true;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** "tools/call log_checkin" for a JSON-RPC body; undefined for notifications and non-JSON. */
function describeRpc(body: string): string | undefined {
  try {
    const msg = JSON.parse(body) as { method?: string; id?: unknown; params?: { name?: string } };
    if (msg.id === undefined || !msg.method) return undefined;
    return msg.params?.name ? `${msg.method} ${msg.params.name}` : msg.method;
  } catch {
    return undefined;
  }
}

/** A local stand-in for a Lambda Function URL: turns HTTP requests into Function URL events. */
async function startFunctionUrl(): Promise<void> {
  const { handler } = await import("./lambda/mcp.js");
  const server = createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${LAMBDA_PORT}`);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
    try {
      const body = await readBody(req);
      const result = await handler({
        rawPath: url.pathname,
        rawQueryString: url.search.slice(1),
        headers,
        body,
        isBase64Encoded: false,
        requestContext: { http: { method: req.method ?? "GET" }, domainName: `127.0.0.1:${LAMBDA_PORT}` },
      });
      res.writeHead(result.statusCode, result.headers).end(result.body);
      const ms = Date.now() - started;
      console.log(`[lambda] McpServer ${req.method} ${url.pathname} -> ${result.statusCode} (${ms} ms)`);
      const rpc = describeRpc(body);
      if (rpc) record("Lambda", `McpServer ${rpc} -> ${result.statusCode} in ${ms} ms`);
    } catch (err) {
      console.error("[lambda] McpServer failed:", err);
      res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ message: "Internal Server Error" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(LAMBDA_PORT, "127.0.0.1", () => resolve()));
}

/** Runs the missed check-in Lambda on a timer, the way the EventBridge rule does on AWS. */
async function startSchedule(): Promise<void> {
  const { handler } = await import("./lambda/checker.js");
  const tick = async () => {
    try {
      const out = await handler();
      const line = `MissedCheckins -> ${out.misses} missed, ${out.sent} new alert(s) published`;
      console.log(`[eventbridge] ${line}`);
      record("EventBridge", line);
    } catch (err) {
      console.error("[eventbridge] MissedCheckins failed:", err);
    }
  };
  setInterval(tick, SCHEDULE_MINUTES * 60_000).unref();
  void tick();
}

await startDynamo();
if (await ensureTable(process.argv.includes("--seed"))) {
  await import("./seed.js");
}
await startFunctionUrl();
await startSchedule();

const { loadConfig } = await import("./config.js");
const { startServer } = await import("./server.js");
const config = loadConfig();
await startServer(config, {
  mcpUrl: `http://127.0.0.1:${LAMBDA_PORT}/mcp`,
  alertCheckMinutes: 0,
  environment: {
    DynamoDB: `table "${tableName}" on the local emulator (port ${DDB_PORT})`,
    Lambda: `MCP handler behind a local Function URL, http://127.0.0.1:${LAMBDA_PORT}/mcp`,
    EventBridge: `missed check-in Lambda every ${SCHEDULE_MINUTES} min`,
    SNS: "alerts printed in the terminal and listed below",
    Bedrock: config.summarizer === "bedrock" ? "Claude summaries" : "off (built-in summaries)",
  },
});
console.log(`
Emulated AWS is running:
  DynamoDB     http://127.0.0.1:${DDB_PORT}   (table ${tableName}, data in ${DATA_DIR})
  Function URL http://127.0.0.1:${LAMBDA_PORT}/mcp
  EventBridge  every ${SCHEDULE_MINUTES} min
Open http://${config.host}:${config.port}/ to use it.`);
