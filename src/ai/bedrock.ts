import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type { StatusSnapshot, Summarizer, WeeklySnapshot } from "./summarizer.js";
import { TemplateSummarizer } from "./summarizer.js";

const STATUS_PROMPT = `You write short spoken updates for a family caring for an aging parent.
You receive JSON with today's medication checklist, logged events and upcoming reminders.
Answer in two to four plain sentences that sound natural when read aloud by a voice assistant.
Lead with anything that needs attention (an overdue dose, no check-in, a low mood), then the rest.
Use only the data given. Never give medical advice or guess at causes.`;

const WEEKLY_PROMPT = `You write a one-page weekly care summary that a family member can bring to a doctor's appointment.
You receive JSON with a week of logged events, daily dose counts and days without a morning check-in.
Write plain text with short sections: Medication adherence, Check-ins, Mood and energy, Meals, Notes worth raising.
Quote the parent's own words where they help. Use only the data given; do not diagnose or advise.
End with: "This summary only reflects what was logged. It is not medical advice."`;

/** Summaries written by Claude on Amazon Bedrock. Falls back to templates if a call fails. */
export class BedrockSummarizer implements Summarizer {
  private readonly client: AnthropicBedrockMantle;
  private readonly fallback = new TemplateSummarizer();

  constructor(private readonly model: string, region: string) {
    this.client = new AnthropicBedrockMantle({ awsRegion: region });
  }

  private async write(system: string, data: unknown): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4000,
      output_config: { effort: "low" },
      system,
      messages: [{ role: "user", content: JSON.stringify(data) }],
    });
    if (response.stop_reason === "refusal") throw new Error("model declined");
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    if (!text) throw new Error("empty response");
    return text;
  }

  async status(s: StatusSnapshot): Promise<string> {
    try {
      return await this.write(STATUS_PROMPT, s);
    } catch (err) {
      console.warn("[bedrock] status summary failed, using template:", (err as Error).message);
      return this.fallback.status(s);
    }
  }

  async weekly(s: WeeklySnapshot): Promise<string> {
    try {
      return await this.write(WEEKLY_PROMPT, s);
    } catch (err) {
      console.warn("[bedrock] weekly summary failed, using template:", (err as Error).message);
      return this.fallback.weekly(s);
    }
  }
}
