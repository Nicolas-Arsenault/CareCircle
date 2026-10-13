// AWS Lambda entry point for the MCP endpoint, behind a Lambda Function URL.
// Uses the SDK's web-standard Streamable HTTP transport (Request in, Response out),
// in stateless JSON mode, so no adapter layer is needed.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { loadConfig } from "../config.js";
import { createCare } from "../app.js";
import { createMcpServer } from "../mcp.js";

interface FunctionUrlEvent {
  rawPath: string;
  rawQueryString?: string;
  headers: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string }; domainName: string };
}

interface FunctionUrlResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const config = loadConfig();
const care = createCare(config);

function json(statusCode: number, body: unknown, extra: Record<string, string> = {}): FunctionUrlResult {
  return { statusCode, headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) };
}

export async function handler(event: FunctionUrlEvent): Promise<FunctionUrlResult> {
  const method = event.requestContext.http.method;
  if (event.rawPath === "/healthz") return json(200, { ok: true });
  if (event.rawPath !== "/mcp") return json(404, { error: "Not found" });
  if (method !== "POST") {
    return json(405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, { allow: "POST" });
  }
  if (config.mcpAuthToken && event.headers.authorization !== `Bearer ${config.mcpAuthToken}`) {
    return json(401, { jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
  }

  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers)) if (v !== undefined) headers.set(k, v);
  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body) : undefined;
  const url = `https://${event.requestContext.domainName}${event.rawPath}${event.rawQueryString ? `?${event.rawQueryString}` : ""}`;
  const request = new Request(url, { method, headers, body });

  const server = createMcpServer(care, { timeZone: config.timeZone });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const outHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => (outHeaders[k] = v));
    return { statusCode: response.status, headers: outHeaders, body: await response.text() };
  } finally {
    await transport.close();
    await server.close();
  }
}
