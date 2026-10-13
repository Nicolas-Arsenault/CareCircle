// One-off missed check-in run from the command line: `npm run check`.
import { loadConfig } from "./config.js";
import { createCare } from "./app.js";

const { misses, sent } = await createCare(loadConfig()).runAlertCheck();
if (misses.length === 0) console.log("Nothing missed so far today.");
for (const m of misses) console.log(`${sent.some((s) => s.key === m.key) ? "ALERTED" : "already alerted"}: ${m.message}`);
