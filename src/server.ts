import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response, type NextFunction } from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig, type Config } from "./config.js";
import { createCare } from "./app.js";
import { createMcpServer } from "./mcp.js";
import type { CareService } from "./care.js";
import { AlexaSimulator } from "./alexa/simulator.js";
import { recentActivity } from "./activity.js";

const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(here, "..", "web");
const NODE_MODULES = join(here, "..", "node_modules");

/**
 * Browser assets the family page loads, served from local npm packages so the
 * demo works offline (no CDN): Phosphor icon fonts and the Geist typefaces.
 */
const VENDOR_ASSETS: Record<string, string> = {
  "/vendor/phosphor": join(NODE_MODULES, "@phosphor-icons", "web", "src"),
  "/vendor/geist": join(NODE_MODULES, "@fontsource-variable", "geist"),
  "/vendor/geist-mono": join(NODE_MODULES, "@fontsource-variable", "geist-mono"),
};

/** Builds the HTTP app: the MCP endpoint, a small JSON API for the family page, and the simulator. */
export function createHttpApp(
  config: Config,
  care: CareService,
  simulator?: AlexaSimulator,
  environment?: Record<string, string>,
): express.Express {
  const allowedHosts = (process.env.ALLOWED_HOSTS ?? "").split(",").filter(Boolean);
  const app = createMcpExpressApp({
    host: config.host,
    ...(allowedHosts.length ? { allowedHosts } : {}),
  });

  const requireToken = (req: Request, res: Response, next: NextFunction) => {
    if (!config.mcpAuthToken || req.headers.authorization === `Bearer ${config.mcpAuthToken}`) return next();
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
  };

  // Stateless Streamable HTTP: a fresh server and transport per request, so it scales
  // horizontally and runs unchanged on Lambda.
  app.post("/mcp", requireToken, async (req, res) => {
    const server = createMcpServer(care, { timeZone: config.timeZone });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp] request failed:", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });
  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  };
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  // JSON API used by the family page.
  const api = express.Router();
  const wrap = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  };
  // Which backends are active, so the page can show where data and alerts are going.
  api.get(
    "/config",
    wrap(async () => ({
      parentName: config.parentName,
      timeZone: config.timeZone,
      checkinDeadline: config.checkinDeadline,
      brain: simulator ? process.env.ALEXA_BRAIN ?? "rules" : null,
      store: config.store,
      summarizer: config.summarizer,
      notifier: config.notifier,
      environment: environment ?? null,
    })),
  );
  api.get("/status", wrap(() => care.getStatus()));
  api.get("/activity", wrap(async () => recentActivity()));
  api.get("/today", wrap(() => care.listToday()));
  api.get("/upcoming", wrap(() => care.upcoming()));
  api.get("/timeline", wrap((req) => care.getTimeline(Number(req.query.days ?? 7))));
  api.post("/check", wrap(() => care.runAlertCheck()));
  api.get("/weekly", wrap(() => care.weeklySummary()));
  // Raw 7-day numbers (doses per day, events, missed check-ins) for the dashboard widgets.
  // No summarizer call, so it is cheap to poll even when SUMMARIZER=bedrock.
  api.get("/week", wrap(() => care.weeklySnapshot()));
  if (simulator) {
    api.post(
      "/alexa",
      wrap(async (req) => {
        const { utterance, speaker } = req.body ?? {};
        if (typeof utterance !== "string" || !utterance.trim()) throw new Error("Say something first.");
        return simulator.handle(utterance.trim(), typeof speaker === "string" ? speaker : undefined);
      }),
    );
  }
  app.use("/api", api);
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });
  for (const [route, dir] of Object.entries(VENDOR_ASSETS)) app.use(route, express.static(dir));
  app.use(express.static(WEB_DIR));
  return app;
}

export interface StartOptions {
  /** Where the simulated Alexa sends MCP requests. Defaults to this server's own /mcp. */
  mcpUrl?: string;
  /** How often to check for missed check-ins, in minutes. 0 turns it off. */
  alertCheckMinutes?: number;
  /** Describes the emulated AWS environment for the dashboard, when running `npm run aws:local`. */
  environment?: Record<string, string>;
}

/** Starts the local server: MCP endpoint, family page and simulated Alexa. */
export async function startServer(config: Config, opts: StartOptions = {}): Promise<void> {
  const care = createCare(config);
  const simulator = new AlexaSimulator({
    mcpUrl: opts.mcpUrl ?? process.env.MCP_URL ?? `http://127.0.0.1:${config.port}/mcp`,
    authToken: config.mcpAuthToken,
    parentName: config.parentName,
    timeZone: config.timeZone,
    brain: process.env.ALEXA_BRAIN === "bedrock" ? "bedrock" : "rules",
    bedrockModel: config.bedrockModel,
    awsRegion: config.awsRegion,
  });
  const app = createHttpApp(config, care, simulator, opts.environment);

  await new Promise<void>((resolve) => {
    app.listen(config.port, config.host, () => {
      console.log(`CareCircle is running.
  MCP endpoint:   http://${config.host}:${config.port}/mcp
  Family page:    http://${config.host}:${config.port}/
  Storage: ${config.store}   Summaries: ${config.summarizer}   Alerts: ${config.notifier}`);
      resolve();
    });
  });

  // Locally, check for missed check-ins every few minutes. On AWS, EventBridge does this.
  const minutes = opts.alertCheckMinutes ?? Number(process.env.ALERT_CHECK_MINUTES ?? "5");
  if (minutes > 0) {
    setInterval(() => {
      care.runAlertCheck().catch((err) => console.error("[alerts] check failed:", err));
    }, minutes * 60_000).unref();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void startServer(loadConfig());
}
