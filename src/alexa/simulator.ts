import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { planCalls } from "./rules.js";

export interface TraceEntry {
  tool: string;
  arguments: Record<string, unknown>;
  result: string;
  isError: boolean;
}

export interface AlexaTurn {
  reply: string;
  trace: TraceEntry[];
  brain: "rules" | "bedrock";
}

export interface SimulatorOptions {
  /** URL of the CareCircle MCP endpoint, e.g. http://127.0.0.1:3000/mcp. */
  mcpUrl: string;
  authToken?: string;
  parentName: string;
  timeZone: string;
  brain: "rules" | "bedrock";
  bedrockModel: string;
  awsRegion: string;
}

const SYSTEM = (parent: string, speaker: string, now: string) => `You are Alexa, a voice assistant, using the CareCircle add-on.
CareCircle keeps a shared care log for ${parent} and their family.
The person speaking right now is ${speaker}. ${speaker === parent ? "" : `They are a family member, so pass by="${speaker}" when they log something.`}
The current local date and time is ${now}.
Use the tools to act on what was said, then answer in one to three short spoken sentences. No lists or markdown.`;

/**
 * Plays the part of Alexa+ for demos: takes an utterance, decides which CareCircle tools
 * to call, and calls them over real MCP (Streamable HTTP), exactly as Alexa+ would.
 */
export class AlexaSimulator {
  private bedrock?: AnthropicBedrockMantle;

  constructor(private readonly opts: SimulatorOptions) {}

  private async connect(): Promise<Client> {
    const client = new Client({ name: "carecircle-alexa-simulator", version: "0.1.0" });
    const headers: Record<string, string> = {};
    if (this.opts.authToken) headers.Authorization = `Bearer ${this.opts.authToken}`;
    await client.connect(new StreamableHTTPClientTransport(new URL(this.opts.mcpUrl), { requestInit: { headers } }));
    return client;
  }

  private async call(client: Client, name: string, args: Record<string, unknown>): Promise<TraceEntry> {
    try {
      const out = await client.callTool({ name, arguments: args });
      const content = (out.content ?? []) as { type: string; text?: string }[];
      const result = content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
      return { tool: name, arguments: args, result, isError: Boolean(out.isError) };
    } catch (err) {
      return { tool: name, arguments: args, result: (err as Error).message, isError: true };
    }
  }

  async handle(utterance: string, speaker?: string): Promise<AlexaTurn> {
    const client = await this.connect();
    try {
      return this.opts.brain === "bedrock"
        ? await this.withBedrock(client, utterance, speaker || this.opts.parentName)
        : await this.withRules(client, utterance, speaker);
    } finally {
      await client.close();
    }
  }

  private async withRules(client: Client, utterance: string, speaker?: string): Promise<AlexaTurn> {
    const isParent = !speaker || speaker === this.opts.parentName;
    const trace: TraceEntry[] = [];
    for (const planned of planCalls(utterance, isParent ? undefined : speaker)) {
      trace.push(await this.call(client, planned.name, planned.arguments));
    }
    const logs = trace.filter((t) => t.tool === "log_checkin" && !t.isError);
    const reply =
      logs.length > 1
        ? `Got it. I've logged your ${logs.map((t) => t.arguments.kind).join(" and ")} for the family.`
        : trace.map((t) => t.result).join(" ");
    return { reply, trace, brain: "rules" };
  }

  private async withBedrock(client: Client, utterance: string, speaker: string): Promise<AlexaTurn> {
    this.bedrock ??= new AnthropicBedrockMantle({ awsRegion: this.opts.awsRegion });
    const { tools } = await client.listTools();
    const claudeTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));
    const now = new Date().toLocaleString("en-US", { timeZone: this.opts.timeZone, dateStyle: "full", timeStyle: "short" });
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: utterance }];
    const trace: TraceEntry[] = [];

    for (let turn = 0; turn < 6; turn++) {
      const response = await this.bedrock.messages.create({
        model: this.opts.bedrockModel,
        max_tokens: 4000,
        output_config: { effort: "low" },
        system: SYSTEM(this.opts.parentName, speaker, now),
        tools: claudeTools,
        messages,
      });
      if (response.stop_reason === "refusal") return { reply: "Sorry, I can't help with that.", trace, brain: "bedrock" };
      messages.push({ role: "assistant", content: response.content });
      const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || uses.length === 0) {
        const reply = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
        return { reply, trace, brain: "bedrock" };
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) {
        const entry = await this.call(client, use.name, use.input as Record<string, unknown>);
        trace.push(entry);
        results.push({ type: "tool_result", tool_use_id: use.id, content: entry.result, is_error: entry.isError });
      }
      messages.push({ role: "user", content: results });
    }
    return { reply: trace.map((t) => t.result).join(" "), trace, brain: "bedrock" };
  }
}
