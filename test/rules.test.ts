import { test } from "node:test";
import assert from "node:assert/strict";
import { planCalls } from "../src/alexa/rules.js";

const tools = (u: string, who?: string) => planCalls(u, who).map((c) => c.name);

test("routes common phrases to the right tools", () => {
  assert.deepEqual(tools("How's Mom today?", "Sarah"), ["get_status"]);
  assert.deepEqual(tools("What do I still need to take today?"), ["list_today"]);
  assert.deepEqual(tools("Give me the weekly summary"), ["weekly_summary"]);
  assert.deepEqual(tools("Tell the kids I'm going to bed early"), ["notify_family"]);
  assert.deepEqual(tools("Good morning!"), ["log_checkin"]);
});

test("one sentence can log a meal and a dose", () => {
  const calls = planCalls("Had my oatmeal and the little white pill");
  assert.deepEqual(calls.map((c) => c.arguments.kind).sort(), ["meal", "medication"]);
});

test("mood gets a score", () => {
  const [call] = planCalls("I'm feeling tired today");
  assert.equal(call.arguments.kind, "mood");
  assert.equal(call.arguments.mood, 2);
});

test("parses reminders", () => {
  const [appt] = planCalls("Remind me about the doctor Thursday at 2pm");
  assert.deepEqual(appt.arguments, { kind: "appointment", title: "Doctor", day: "thursday", time: "14:00" });
  const [med] = planCalls("Remind me to take my vitamin D every day at 9am");
  assert.deepEqual(med.arguments, { kind: "medication", title: "Vitamin d", daily_time: "09:00" });
});

test("family members are recorded as the author", () => {
  const [call] = planCalls("Remind me to call the pharmacy tomorrow at 10am", "Sarah");
  assert.equal(call.arguments.by, "Sarah");
  assert.equal(call.arguments.day, "tomorrow");
});
