// An offline stand-in for the Alexa+ language model: maps common phrases to
// CareCircle tool calls with plain pattern matching. Good enough for a demo
// script, and it means the simulator works with no AI account at all.

export interface PlannedCall {
  name: string;
  arguments: Record<string, unknown>;
}

const MOOD_WORDS: [RegExp, number][] = [
  [/\b(terrible|awful|horrible|very bad|miserable)\b/, 1],
  [/\b(sad|lonely|down|dizzy|in pain|pain|hurts?|sick|bad|not (so |too )?(good|great|well))\b/, 2],
  [/\b(tired|sore|meh|so-so|worn out|sleepy|exhausted)\b/, 2],
  [/\b(okay|ok|alright|all right|fine)\b/, 3],
  [/\b(good|well|rested)\b/, 4],
  [/\b(great|wonderful|fantastic|happy|excellent|amazing)\b/, 5],
];

const GENERIC_MED = new Set(["pill", "pills", "medication", "medications", "meds", "medicine", "tablet", "tablets", "dose", "the", "a", "my", "all"]);

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseTime(s: string): string | undefined {
  if (/\bnoon\b/.test(s)) return "12:00";
  if (/\bmorning\b/.test(s) && !/\d/.test(s)) return "08:00";
  if (/\b(evening|night|bedtime)\b/.test(s) && !/\d/.test(s)) return "20:00";
  const m = s.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\s|$|[.,!?])/);
  if (!m || (!m[3] && !m[2] && !/\bat\s+\d/.test(s))) return undefined;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3]?.replace(/\./g, "");
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  // "at 2" with no am/pm: assume afternoon for 1 to 7.
  if (!ampm && h >= 1 && h <= 7) h += 12;
  if (h > 23 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function parseReminder(utterance: string, by: string | undefined): PlannedCall {
  const s = utterance.toLowerCase().replace(/[?!.]+$/, "");
  const daily = /\b(every ?day|every morning|every evening|every night|daily|each day)\b/.test(s);
  const dayMatch = s.match(/\b(today|tomorrow|(?:next |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/);
  const time = parseTime(s);
  const kind = /\b(doctor|dr|dentist|appointment|clinic|hospital|checkup|check-up)\b/.test(s)
    ? "appointment"
    : /\b(pill|pills|med|meds|medication|medicine|tablet|take my|insulin)\b/.test(s)
      ? "medication"
      : "other";

  let title = s
    .replace(/^(please\s+)?(remind me|set a reminder|add a reminder)\s*(to|about|for|that)?\s*/, "")
    .replace(/\b(every ?day|every morning|every evening|every night|daily|each day)\b/g, "")
    .replace(/\b(on|this|next)?\s*(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g, "")
    .replace(/\b(at\s+)?\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)?/g, "")
    .replace(/\b(at\s+)?(noon|in the morning|in the evening|at night)\b/g, "")
    .replace(/^(the|my)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (kind === "medication") title = title.replace(/^take\s+(my\s+)?/, "");
  title = capitalize(title || (kind === "appointment" ? "Appointment" : "Reminder"));

  const args: Record<string, unknown> = { kind, title };
  if (by) args.by = by;
  if (daily || (!dayMatch && kind === "medication")) {
    args.daily_time = time ?? "08:00";
  } else {
    args.day = dayMatch?.[1] ?? "today";
    args.time = time ?? "09:00";
  }
  return { name: "add_reminder", arguments: args };
}

function parseCheckin(utterance: string, by: string | undefined): PlannedCall[] {
  const s = utterance.toLowerCase();
  const calls: PlannedCall[] = [];
  const base = by ? { by } : {};

  if (/\b(took|taken|take|had|swallowed)\b.*\b(pill|pills|med|meds|medication|medicine|tablet|tablets|dose|insulin)\b|\btook (my )?\w+/.test(s)) {
    const named = s.match(/\btook (?:my |the )?([a-z]+)/)?.[1];
    const medication = named && !GENERIC_MED.has(named) ? capitalize(named) : undefined;
    calls.push({ name: "log_checkin", arguments: { kind: "medication", text: utterance, ...(medication ? { medication } : {}), ...base } });
  }
  if (/\b(ate|eaten|eat|breakfast|lunch|dinner|supper|snack|oatmeal|soup|toast|sandwich|meal)\b/.test(s)) {
    calls.push({ name: "log_checkin", arguments: { kind: "meal", text: utterance, ...base } });
  }
  if (/\b(feel|feeling|felt|i'm|i am|im)\b/.test(s)) {
    for (const [re, mood] of MOOD_WORDS) {
      if (re.test(s)) {
        calls.push({ name: "log_checkin", arguments: { kind: "mood", text: utterance, mood, ...base } });
        break;
      }
    }
  }
  if (calls.length === 0 && /\b(good morning|morning|hello|hi|i'm up|i am up|i'm awake|woke up|checking in)\b/.test(s)) {
    calls.push({ name: "log_checkin", arguments: { kind: "checkin", text: utterance, ...base } });
  }
  if (calls.length === 0) calls.push({ name: "log_checkin", arguments: { kind: "note", text: utterance, ...base } });
  return calls;
}

/**
 * Plans tool calls for one utterance.
 * @param speaker who is talking; undefined means the parent.
 */
export function planCalls(utterance: string, speaker?: string): PlannedCall[] {
  // People type the wake word out of habit: "Alexa, how's Mom?"
  utterance = utterance.replace(/^\s*(hey\s+)?alexa[\s,.!:-]*/i, "") || utterance;
  const s = utterance.toLowerCase().trim();
  const by = speaker || undefined;

  if (/\b(weekly|summary|report|this week|for the doctor)\b/.test(s)) return [{ name: "weekly_summary", arguments: {} }];
  if (/\b(remind me|set a reminder|add a reminder)\b/.test(s)) return [parseReminder(utterance, by)];
  if (/^(please\s+)?(tell|let|text|message)\b/.test(s)) {
    const message = utterance
      .replace(/^(please\s+)?(tell|let|text|message)\s+(my |the )?(family|kids|children|everyone|daughter|son|[a-z]+)(\s+know)?\s*(that\s+)?/i, "")
      .trim();
    return [{ name: "notify_family", arguments: { message: capitalize(message || utterance), ...(by ? { by } : {}) } }];
  }
  if (/\b(missed|did .* (miss|forget)|check on)\b/.test(s)) return [{ name: "check_missed", arguments: {} }];
  if (/\b(timeline|what happened|history|log)\b/.test(s) && !/\b(took|feel|ate)\b/.test(s)) {
    return [{ name: "get_timeline", arguments: { days: 3 } }];
  }
  if (/\bwhat\b.*\b(still|left|need to take|do i have|should i take|is next|today)\b|\banything (left|else)\b/.test(s)) {
    return [{ name: "list_today", arguments: {} }];
  }
  if (/\bhow('s| is| are)\b.*\b(doing|today|mom|dad|she|he|things)\b|\b(status|update)\b/.test(s)) {
    return [{ name: "get_status", arguments: {} }];
  }
  return parseCheckin(utterance, by);
}
