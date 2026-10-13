import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import Anthropic from "@anthropic-ai/sdk";
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
  brain: Brain;
}

/** Who plays Alexa+'s model: offline phrase rules, Claude on Bedrock, or Claude through the Anthropic API. */
export type Brain = "rules" | "bedrock" | "claude";

/** The one Messages API call the simulator needs; both the Anthropic and Bedrock clients provide it. */
interface MessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

export interface SimulatorOptions {
  /** URL of the CareCircle MCP endpoint, e.g. http://127.0.0.1:3000/mcp. */
  mcpUrl: string;
  authToken?: string;
  parentName: string;
  timeZone: string;
  brain: Brain;
  bedrockModel: string;
  awsRegion: string;
  /** Model for the "claude" brain, e.g. claude-haiku-5-5. */
  anthropicModel?: string;
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
  private llm?: MessagesClient;

  constructor(private readonly opts: SimulatorOptions) {}

  get brain(): Brain {
    return this.opts.brain;
  }

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
      if (this.opts.brain === "rules") return await this.withRules(client, utterance, speaker);
      try {
        return await this.withClaude(client, utterance, speaker || this.opts.parentName);
      } catch (err) {
        // A model outage shouldn't break the demo: fall back to the offline rules.
        console.error(`[alexa] ${this.opts.brain} brain failed, using rules:`, (err as Error).message);
        return await this.withRules(client, utterance, speaker);
      }
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

  private model(): { llm: MessagesClient; model: string; extra: Partial<Anthropic.MessageCreateParamsNonStreaming> } {
    if (this.opts.brain === "bedrock") {
      this.llm ??= new AnthropicBedrockMantle({ awsRegion: this.opts.awsRegion }) as unknown as MessagesClient;
      return { llm: this.llm, model: this.opts.bedrockModel, extra: { output_config: { effort: "low" } } };
    }
    this.llm ??= new Anthropic();
    return { llm: this.llm, model: this.opts.anthropicModel ?? "claude-haiku-5-5", extra: {} };
  }

  private async withClaude(client: Client, utterance: string, speaker: string): Promise<AlexaTurn> {
    const { llm, model, extra } = this.model();
    const brain = this.opts.brain;
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
      const response = await llm.messages.create({
        ...extra,
        model,
        max_tokens: 4000,
        system: SYSTEM(this.opts.parentName, speaker, now),
        tools: claudeTools,
        messages,
      });
      if (response.stop_reason === "refusal") return { reply: "Sorry, I can't help with that.", trace, brain };
      messages.push({ role: "assistant", content: response.content });
      const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || uses.length === 0) {
        const reply = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
        return { reply, trace, brain };
      }
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) {
        const entry = await this.call(client, use.name, use.input as Record<string, unknown>);
        trace.push(entry);
        results.push({ type: "tool_result", tool_use_id: use.id, content: entry.result, is_error: entry.isError });
      }
      messages.push({ role: "user", content: results });
    }
    return { reply: trace.map((t) => t.result).join(" "), trace, brain };
  }
}
