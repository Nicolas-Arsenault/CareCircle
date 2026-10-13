import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCare } from "./helpers.js";
import { localTime, zonedInstant } from "../src/time.js";

test("zonedInstant round-trips local time across DST", () => {
  for (const [ymd, hhmm] of [["2026-03-08", "08:00"], ["2026-07-01", "23:30"], ["2026-11-01", "09:15"]]) {
    assert.equal(localTime(zonedInstant(ymd, hhmm, "America/Toronto"), "America/Toronto"), hhmm);
  }
});

test("a generic 'took my pills' marks morning doses taken but not evening ones", async () => {
  const { care, setTime } = makeCare();
  await care.addReminder({ kind: "medication", title: "Metformin", dailyTime: "08:00" });
  await care.addReminder({ kind: "medication", title: "Lisinopril", dailyTime: "20:00" });
  setTime("08:30");
  await care.logEvent({ kind: "medication", text: "I took my pills" });
  const { items } = await care.listToday();
  assert.deepEqual(items.map((i) => [i.reminder.title, i.done]), [["Metformin", true], ["Lisinopril", false]]);
});

test("a named dose only marks that medication", async () => {
  const { care, setTime } = makeCare();
  await care.addReminder({ kind: "medication", title: "Metformin", dailyTime: "08:00" });
  await care.addReminder({ kind: "medication", title: "Vitamin D", dailyTime: "08:00" });
  setTime("08:10");
  await care.logEvent({ kind: "medication", text: "took my vitamin d", medication: "vitamin d" });
  const { items } = await care.listToday();
  assert.deepEqual(items.map((i) => [i.reminder.title, i.done]), [["Metformin", false], ["Vitamin D", true]]);
});

test("missed check-in and dose alert the family once each", async () => {
  const { care, notifier, setTime } = makeCare();
  await care.addReminder({ kind: "medication", title: "Metformin", dailyTime: "08:00" });

  setTime("09:30");
  assert.equal((await care.runAlertCheck()).misses.length, 1, "dose is 90 min late; check-in deadline not reached");

  setTime("10:05");
  const second = await care.runAlertCheck();
  assert.equal(second.misses.length, 2);
  assert.equal(second.sent.length, 1, "only the new check-in miss is sent");

  const third = await care.runAlertCheck();
  assert.equal(third.sent.length, 0);
  assert.equal(notifier.sent.length, 2);
  assert.match(notifier.sent[1].message, /hasn't checked in/);
});

test("a check-in before the deadline prevents the alert", async () => {
  const { care, setTime } = makeCare();
  setTime("07:45");
  await care.logEvent({ kind: "checkin", text: "Good morning" });
  setTime("11:00");
  assert.deepEqual(await care.findMissed(), []);
});

test("status summary mentions doses, mood and the next appointment", async () => {
  const { care, setTime } = makeCare();
  await care.addReminder({ kind: "medication", title: "Metformin", dailyTime: "08:00" });
  await care.addReminder({ kind: "appointment", title: "Dr. Patel checkup", date: "2026-10-15", time: "14:00" });
  setTime("08:05");
  await care.logEvent({ kind: "medication", text: "took my metformin", medication: "Metformin" });
  await care.logEvent({ kind: "mood", text: "feeling tired", mood: 2 });
  const { summary } = await care.getStatus();
  assert.match(summary, /taken 1 of 1/);
  assert.match(summary, /low/);
  assert.match(summary, /Dr\. Patel checkup Thursday at 2 PM/);
});

test("weekly summary counts adherence across days", async () => {
  const { care, setTime } = makeCare("2026-10-07T07:00");
  await care.addReminder({ kind: "medication", title: "Metformin", dailyTime: "08:00" });
  for (const day of ["2026-10-07", "2026-10-08", "2026-10-09"]) {
    setTime("08:05", day);
    await care.logEvent({ kind: "medication", text: "took it", medication: "Metformin" });
  }
  setTime("12:00", "2026-10-13");
  const { snapshot, summary } = await care.weeklySummary();
  assert.equal(snapshot.from, "2026-10-07");
  assert.equal(snapshot.doses.reduce((n, d) => n + d.scheduled, 0), 7);
  assert.equal(snapshot.doses.reduce((n, d) => n + d.taken, 0), 3);
  assert.match(summary, /3 of 7 scheduled doses/);
});

test("reminders reject bad times", async () => {
  const { care } = makeCare();
  await assert.rejects(care.addReminder({ kind: "other", title: "x", dailyTime: "8am" }), /HH:MM/);
  await assert.rejects(care.addReminder({ kind: "other", title: "x" }), /dailyTime/);
});
