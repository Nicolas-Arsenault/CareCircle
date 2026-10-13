// AWS Lambda entry point run by an EventBridge schedule: alerts the family
// (through SNS) about missed check-ins and unconfirmed doses.
import { loadConfig } from "../config.js";
import { createCare } from "../app.js";

const care = createCare(loadConfig());

export async function handler(): Promise<{ misses: number; sent: number }> {
  const { misses, sent } = await care.runAlertCheck();
  console.log(JSON.stringify({ misses, sent }));
  return { misses: misses.length, sent: sent.length };
}
