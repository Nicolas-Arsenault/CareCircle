import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CareService } from "./care.js";
import { EVENT_KINDS, REMINDER_KINDS, type Reminder } from "./types.js";
import { addDays, localDate, localTime, spokenTime, weekday } from "./time.js";

const INSTRUCTIONS = `CareCircle keeps a shared care log for an aging parent and their family.
The parent talks to it to check in ("I took my pills", "I'm feeling tired today") and to set reminders.
Family members ask how the parent is doing and get a short summary.
Map natural speech to the tools: one log_checkin per distinct thing said (a meal and a pill are two calls).
Keep spoken answers short and warm. Never give medical advice.`;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function text(message: string) {
  return { content: [{ type: "text" as const, text: message }] };
}

function describeReminder(r: Reminder, tz: string): string {
  if (r.dailyTime) return `${r.title} every day at ${spokenTime(r.dailyTime)}`;
  const at = new Date(r.dueAt!);
  return `${r.title} on ${weekday(at, tz)} ${localDate(at, tz)} at ${spokenTime(localTime(at, tz))}`;
}

/** Resolves "today", "tomorrow", a weekday name or YYYY-MM-DD to a local date. */
export function resolveDay(day: string, now: Date, tz: string): string {
  const d = day.trim().toLowerCase();
  const today = localDate(now, tz);
  if (d === "today") return today;
  if (d === "tomorrow") return addDays(today, 1);
  const idx = WEEKDAYS.indexOf(d.replace(/^(next|this)\s+/, ""));
  if (idx >= 0) {
    const current = WEEKDAYS.indexOf(weekday(now, tz).toLowerCase());
    const ahead = (idx - current + 7) % 7 || 7;
    return addDays(today, ahead);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  throw new Error(`I couldn't understand the day "${day}". Use today, tomorrow, a weekday, or YYYY-MM-DD.`);
}

/** Builds the CareCircle MCP server. One instance per request in stateless HTTP mode. */
export function createMcpServer(care: CareService, opts: { timeZone: string; now?: () => Date }): McpServer {
  const tz = opts.timeZone;
  const now = opts.now ?? (() => new Date());
  const server = new McpServer(
    { name: "carecircle", title: "CareCircle", version: "0.1.0" },
    { instructions: INSTRUCTIONS },
  );
  const name = care.parentName;

  server.registerTool(
    "log_checkin",
    {
      title: "Log a check-in",
      description:
        `Record something ${name} did or felt, in the shared family care log. ` +
        `Use kind "medication" for pills or doses (set medication when a specific one is named), ` +
        `"meal" for food, "mood" for how they feel (set mood 1 to 5), "checkin" for a hello or ` +
        `good morning, and "note" for anything else. A family member logging on the parent's behalf sets by to their name.`,
      inputSchema: {
        kind: z.enum(EVENT_KINDS).describe("What kind of entry this is."),
        text: z.string().min(1).describe("What was said, in the speaker's words."),
        medication: z.string().optional().describe("Medication name, only if one was named."),
        mood: z.number().int().min(1).max(5).optional().describe("1 very low, 3 okay, 5 great. Only for kind mood."),
        by: z.string().optional().describe(`Who is logging it. Defaults to ${name}.`),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const event = await care.logEvent(args);
      const when = spokenTime(localTime(new Date(event.at), tz));
      const what =
        event.kind === "medication"
          ? `${event.medication ?? "medication"} taken`
          : event.kind === "mood"
            ? "how you're feeling"
            : event.kind === "meal"
              ? "your meal"
              : "your check-in";
      return text(`Got it. I've noted ${what} at ${when}, and the family can see it.`);
    },
  );

  server.registerTool(
    "add_reminder",
    {
      title: "Add a reminder",
      description:
        `Add a reminder the whole family can see. For a daily medication give daily_time. ` +
        `For a one-time thing like a doctor's appointment give day and time.`,
      inputSchema: {
        kind: z.enum(REMINDER_KINDS).describe("medication, appointment or other."),
        title: z.string().min(1).describe('Short name, e.g. "Metformin" or "Dr. Patel appointment".'),
        daily_time: z.string().optional().describe("For daily reminders: 24h local time HH:MM, e.g. 08:00."),
        day: z.string().optional().describe('For one-time reminders: "today", "tomorrow", a weekday like "thursday", or YYYY-MM-DD.'),
        time: z.string().optional().describe("For one-time reminders: 24h local time HH:MM."),
        by: z.string().optional().describe(`Who is adding it. Defaults to ${name}.`),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      try {
        const reminder = await care.addReminder({
          kind: args.kind,
          title: args.title,
          dailyTime: args.daily_time,
          date: args.day ? resolveDay(args.day, now(), tz) : undefined,
          time: args.time,
          by: args.by,
        });
        return text(`Done. I added ${describeReminder(reminder, tz)}.`);
      } catch (err) {
        return { ...text((err as Error).message), isError: true };
      }
    },
  );

  server.registerTool(
    "list_today",
    {
      title: "What's left today",
      description: `List today's medications and appointments for ${name}, and which are done. Use for "what do I still need to take today?".`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { date, items } = await care.listToday();
      if (items.length === 0) return text(`There's nothing scheduled for today (${date}).`);
      const left = items.filter((i) => !i.done && i.reminder.kind === "medication");
      const lines = items.map(
        (i) => `- ${spokenTime(i.time)}: ${i.reminder.title}${i.reminder.kind === "medication" ? (i.done ? " (taken)" : " (not yet)") : ""}`,
      );
      const lead =
        left.length === 0
          ? "All of today's medications are taken."
          : `Still to take today: ${left.map((i) => `${i.reminder.title} at ${spokenTime(i.time)}`).join(", ")}.`;
      return text(`${lead}\n\nToday, ${date}:\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "get_status",
    {
      title: `How is ${name} today?`,
      description: `A short spoken summary of ${name}'s day so far: check-ins, medications taken or overdue, mood and what's coming up. Use for "how's ${name} doing?".`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => text((await care.getStatus()).summary),
  );

  server.registerTool(
    "get_timeline",
    {
      title: "Recent timeline",
      description: "The shared care log for the last few days: every check-in, plus alerts sent to the family.",
      inputSchema: { days: z.number().int().min(1).max(30).optional().describe("How many days back. Default 3.") },
      annotations: { readOnlyHint: true },
    },
    async ({ days }) => {
      const { events, alerts } = await care.getTimeline(days ?? 3);
      const rows = [
        ...events.map((e) => ({ at: e.at, line: `${e.by}: ${e.text}` })),
        ...alerts.map((a) => ({ at: a.sentAt, line: `Alert: ${a.message}` })),
      ].sort((a, b) => a.at.localeCompare(b.at));
      if (rows.length === 0) return text("Nothing has been logged yet.");
      return text(
        rows
          .map((r) => {
            const d = new Date(r.at);
            return `${weekday(d, tz)} ${spokenTime(localTime(d, tz))}: ${r.line}`;
          })
          .join("\n"),
      );
    },
  );

  server.registerTool(
    "check_missed",
    {
      title: "Check for missed check-ins",
      description:
        "Find anything that should have happened by now but didn't: no morning check-in, or a dose not confirmed. " +
        "Alerts the family once per miss. This also runs automatically on a schedule.",
      inputSchema: {},
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async () => {
      const { misses, sent } = await care.runAlertCheck();
      if (misses.length === 0) return text("Nothing missed so far today.");
      return text(
        `${misses.map((m) => m.message).join(" ")} ${sent.length ? `I've let the family know.` : "The family was already told."}`,
      );
    },
  );

  server.registerTool(
    "notify_family",
    {
      title: "Message the family",
      description: `Send a short message to everyone in the family circle by text or email, e.g. "tell the kids I'm going to bed early".`,
      inputSchema: {
        message: z.string().min(1).describe("The message to pass on."),
        by: z.string().optional().describe(`Who it's from. Defaults to ${name}.`),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async ({ message, by }) => {
      await care.notifyFamily(message, by);
      return text("Okay, I've sent that to the family.");
    },
  );

  server.registerTool(
    "weekly_summary",
    {
      title: "Weekly summary for the doctor",
      description: `A one-page summary of ${name}'s last 7 days (medication adherence, check-ins, mood, meals, notes) to bring to a doctor's appointment.`,
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => text((await care.weeklySummary()).summary),
  );

  return server;
}
