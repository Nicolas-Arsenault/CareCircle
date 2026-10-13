// All runtime settings come from environment variables so the same code runs
// on a laptop (no AWS account needed) and on AWS Lambda.

export type StoreKind = "memory" | "file" | "dynamodb";
export type SummarizerKind = "template" | "bedrock";
export type NotifierKind = "console" | "sns";

export interface Config {
  port: number;
  host: string;
  /** Which care circle (family) this server instance serves. */
  circleId: string;
  /** How the parent is referred to in summaries, e.g. "Mom". */
  parentName: string;
  /** IANA time zone the parent lives in; "today" and deadlines use it. */
  timeZone: string;
  /** Local time (HH:MM) by which the parent should have checked in. */
  checkinDeadline: string;
  /** Minutes after a scheduled dose before it counts as missed. */
  doseGraceMinutes: number;
  store: StoreKind;
  dataFile: string;
  tableName: string;
  summarizer: SummarizerKind;
  bedrockModel: string;
  awsRegion: string;
  notifier: NotifierKind;
  snsTopicArn: string;
  /** Optional shared secret. When set, /mcp requires "Authorization: Bearer <token>". */
  mcpAuthToken: string;
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export function loadConfig(): Config {
  return {
    port: Number(env("PORT", "3000")),
    host: env("HOST", "127.0.0.1"),
    circleId: env("CIRCLE_ID", "default"),
    parentName: env("PARENT_NAME", "Mom"),
    timeZone: env("CARE_TIMEZONE", "America/Toronto"),
    checkinDeadline: env("CHECKIN_DEADLINE", "10:00"),
    doseGraceMinutes: Number(env("DOSE_GRACE_MINUTES", "60")),
    store: env("STORE", "file") as StoreKind,
    dataFile: env("DATA_FILE", "data/carecircle.json"),
    tableName: env("TABLE_NAME", "CareCircle"),
    summarizer: env("SUMMARIZER", "template") as SummarizerKind,
    bedrockModel: env("BEDROCK_MODEL_ID", "anthropic.claude-opus-5-5"),
    awsRegion: env("AWS_REGION", "us-east-1"),
    notifier: env("NOTIFIER", "console") as NotifierKind,
    snsTopicArn: env("SNS_TOPIC_ARN", ""),
    mcpAuthToken: env("MCP_AUTH_TOKEN", ""),
  };
}
