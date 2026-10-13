# CareCircle: Devpost submission

> Copy each section into the matching Devpost field. Images use raw GitHub links to `main`, so they show up in Devpost's markdown once this branch is merged; the same files are in `docs/images/` for the image gallery.
>
> **Video field:** Devpost takes a YouTube, Vimeo or Youku link. Upload `docs/video/carecircle-motion.mp4` (66 s) and paste its link. Use `docs/images/story/01-title.jpg` as the thumbnail.
>
> **Image gallery (3:2 or 16:9):** `story/01-title.jpg` first, then `story/03-mom-talks.jpg`, `story/04-shared-log.jpg`, `story/05-sarah-asks.jpg`, `story/06-missed-dose.jpg`, `story/07-doctor-summary.jpg`, `architecture.png`, `screenshots/02-dashboard.png`.

**Tagline:** An Alexa+ add-on that keeps an aging parent and their family in the loop.

**Track:** Alexa+ (MCP add-on)

**Built with:** TypeScript, Node.js, Model Context Protocol (spec 2025-11-25, Streamable HTTP), Alexa+ MCP Toolkit, AWS Lambda (Function URLs), Amazon DynamoDB, Amazon EventBridge, Amazon SNS, Amazon Bedrock (Claude), AWS CDK, Express, Zod, dynalite, Playwright

**Links:**
- Code: https://github.com/Nicolas-Arsenault/CareCircle (MIT)
- Motion demo: `docs/video/carecircle-motion.mp4`
- Real app walkthrough: `docs/video/app-walkthrough.mp4`

![CareCircle](https://raw.githubusercontent.com/Nicolas-Arsenault/CareCircle/main/docs/images/story/01-title.jpg)

## Inspiration

![Mom lives alone. Sarah lives three hours away.](https://raw.githubusercontent.com/Nicolas-Arsenault/CareCircle/main/docs/images/story/02-family.jpg)

Millions of adults look after a parent who still lives alone. The worry is constant and low-grade: did Mom take her pills, did she eat, is she just tired or is something wrong? The usual answer is to phone several times a day, which wears on everyone, or to put an app in front of someone who doesn't want to learn one.

Voice is the right interface here. An older parent already says "good morning" to the Echo in the kitchen. If Alexa can turn that into a shared log the family can ask about, nobody has to learn anything new, and the family gets peace of mind without hovering.

## What it does

CareCircle is a care log that both sides of the family talk to through Alexa+.

![Mom just talks](https://raw.githubusercontent.com/Nicolas-Arsenault/CareCircle/main/docs/images/story/03-mom-talks.jpg)

**Mom just talks.** "Good morning", "had my oatmeal and the little white pill", "I'm feeling tired today". Alexa+ maps each sentence to CareCircle's tools; a single sentence can log a meal and a dose at once. A generic "took my pills" marks the doses due around then, so the morning pills don't cover the evening ones; "took my metformin" marks that one.

![Every call lands in the shared log](https://raw.githubusercontent.com/Nicolas-Arsenault/CareCircle/main/docs/images/story/04-shared-log.jpg)

**One shared log.** Every call goes through the MCP server on Lambda into DynamoDB, and the family dashboard updates within seconds.

![Sarah asks how Mom is doing](https://raw.githubusercontent.com/Nicolas-Arsenault/CareCircle/main/docs/images/story/05-sarah-asks.jpg)

**The family asks.** Sarah, three hours away, asks "How's Mom today?" and hears one short paragraph: when Mom first checked in, how many medications she's taken, her mood, meals, and what's coming up.

![It notices what didn't happen](https://raw.githubusercontent.com/Nicolas-Arsenault/CareCircle/main/docs/images/story/06-missed-dose.jpg)

**It notices what didn't happen.** A scheduled job checks every 15 minutes. If there's no check-in by 10 AM, or a dose is more than an hour late, the family gets one text or email through SNS, and only one per miss.

![One page for the doctor](https://raw.githubusercontent.com/Nicolas-Arsenault/CareCircle/main/docs/images/story/07-doctor-summary.jpg)

**One page for the doctor.** `weekly_summary` turns a week of logs into dose adherence, check-in streak, mood trend and anything worth raising at the appointment. It uses Claude on Amazon Bedrock when enabled and plain templates otherwise.

![The demo app: simulated Alexa and the family dashboard](https://raw.githubusercontent.com/Nicolas-Arsenault/CareCircle/main/docs/images/screenshots/02-dashboard.png)

**A family dashboard.** Colour-coded widgets for check-in, medications, mood, meals, the week's dose grid, the next visit, alerts sent, and a live "Behind the scenes" feed of every Lambda call, scheduled run and alert.

Also:

- **Reminders and appointments.** "Remind me about the doctor Thursday at 2" works from either side.
- **No medical advice.** CareCircle only reports what was logged, and says so.

The eight MCP tools: `log_checkin`, `add_reminder`, `list_today`, `get_status`, `get_timeline`, `check_missed`, `notify_family`, `weekly_summary`.

## How we built it

![Architecture](https://raw.githubusercontent.com/Nicolas-Arsenault/CareCircle/main/docs/images/architecture.png)

- **MCP server.** Built with the official TypeScript MCP SDK, speaking MCP spec 2025-11-25 over stateless Streamable HTTP, so it runs the same way on a laptop and inside a Lambda Function URL with no adapter layer. Tool inputs are Zod schemas with descriptions written for Alexa+'s model, which reads the tool list and decides what to call. There's no intent model to maintain.
- **Care logic in one place.** `src/care.ts` holds all behaviour (dose matching, missed check-in detection, de-duplicated alerts, status and weekly snapshots). The MCP tools, the dashboard API and the Lambda handlers are thin wrappers around it, so every surface agrees.
- **AWS, in one CDK stack.** A DynamoDB on-demand single table (`pk`/`sk`) for events, reminders and alerts; the MCP server on Lambda (Node 22, ARM) behind a Function URL; an EventBridge rule that runs a second Lambda every 15 minutes to find misses; an SNS topic that texts or emails the family; and optional Bedrock permissions for Claude summaries. At hackathon traffic it fits in the free tier, apart from Bedrock calls.
- **Emulated AWS for development.** `npm run aws:local` runs the real Lambda handlers against dynalite (a DynamoDB-compatible server), a local Function URL, a timer standing in for EventBridge, and console output standing in for SNS. The dashboard shows each emulated service at work.
- **A simulated Alexa.** Real Alexa+ toolkit access goes through Amazon (see Challenges), so the web app includes a simulated Alexa that calls the MCP endpoint over real Streamable HTTP, exactly as Alexa+ would, and shows each `tools/call` with its arguments and result. It understands speech with offline rules by default, or with Claude on Bedrock (`ALEXA_BRAIN=bedrock`) choosing the tools the way Alexa+'s model does.
- **Tests.** `node:test` suites cover the care logic, phrase routing, and a full MCP round trip over HTTP.

![Emulated AWS](https://raw.githubusercontent.com/Nicolas-Arsenault/CareCircle/main/docs/images/local-aws.png)

## Challenges we ran into

- **Getting onto real Alexa+.** The MCP Toolkit needs an IAM role in Amazon's account arranged through an Alexa Solutions Architect, plus CodeArtifact access for the CLI. There was no self-serve path for a solo developer, so we built the simulator to call the same endpoint the same way, and kept the server toolkit-ready.
- **OAuth before "hello world".** Alexa+ add-ons need OAuth 2.1 with PKCE and RFC 9728 metadata, and Dynamic Client Registration isn't supported yet. That's a full authorization server before the first call. CareCircle ships an optional bearer token for self-hosting, with Cognito as the planned path.
- **A 500 ms budget.** Tool responses must come back in under half a second, which rules out an LLM call inside the voice path. Spoken answers use fast, deterministic templates; Bedrock is reserved for the weekly summary.
- **An AWS account that couldn't deploy.** Our account's Free plan blocks the services the stack needs, so we built the emulated AWS mode to exercise the real handlers and data model end to end without a deploy.
- **Natural dose matching.** "Took my pills" at 8 AM must not tick off the 8 PM dose, while "took my metformin" should tick off Metformin whenever it's said. Getting that right took a time window around each scheduled dose.

## Accomplishments that we're proud of

- The proactive loop: CareCircle notices what *didn't* happen and tells the family once, which is the part a plain reminder bot misses.
- One codebase that runs as a laptop server, as emulated AWS, and as real Lambda, with the same handlers in all three.
- A dashboard that makes the invisible visible: every MCP call and every scheduled run is on screen, so judges can see the plumbing work.
- It's honest about health: no diagnosis, no advice, just what was logged.

## What we learned

- MCP tool descriptions are the product's UX when an LLM is the router. Clear names and argument descriptions did more for accuracy than any parsing code.
- Stateless Streamable HTTP is a great fit for Lambda: no session store, no WebSocket plumbing.
- Building the emulator early paid off. Every feature was tested against DynamoDB semantics from day one.

## What's next for CareCircle

- OAuth 2.1 with Amazon Cognito, then registration through the Alexa+ MCP Toolkit and testing on a real Echo.
- Per-family-member consent and roles (who can read what, who gets alerts).
- Gentle escalation: a spoken nudge to the parent first, then a text to the family.
- Ring integration: "no front-door activity this morning" as another signal for a missed check-in.
- MCP Apps visual cards on Echo Show for the daily checklist.
- Packaging the scaffold as a reusable `alexa-mcp-kit` for other Alexa+ add-ons.

## AWS Builder challenge

CareCircle's backend is defined in one AWS CDK stack (`infra/lib/carecircle-stack.ts`):

| Service | Role |
|---|---|
| AWS Lambda + Function URL | Hosts the MCP server (stateless Streamable HTTP) |
| Amazon DynamoDB | Single-table store for events, reminders and alerts (on-demand) |
| Amazon EventBridge | Runs the missed check-in Lambda every 15 minutes |
| Amazon SNS | Texts or emails the family when something is missed |
| Amazon Bedrock | Claude writes the weekly doctor summary (optional, with template fallback) |
| AWS CDK | One `cdk deploy` creates it all; `cdk destroy` removes it |

Status, stated plainly: the stack is written and synthesizes, but we could not deploy it because our AWS account's Free plan blocks these services. Every Lambda handler and the DynamoDB data model run end to end under `npm run aws:local`, which emulates DynamoDB, the Function URL, EventBridge and SNS on one machine, and that is what the demo shows.

## Open source

MIT-licensed at https://github.com/Nicolas-Arsenault/CareCircle. It runs with `npm install && npm run dev` and no cloud account. The simulated Alexa, the emulated AWS mode, the CDK stack and the tests are all in the repo, along with the source for every diagram and the motion demo (`docs/video/motion.html`).

## Product feedback (Alexa+ and AWS)

- **Alexa+ MCP Toolkit:** a self-serve sandbox for individual developers (even rate-limited) would open the platform to hackathon builders. Today the IAM-role and Solutions Architect step means most solo entries can't test on real Alexa+.
- **Auth:** Dynamic Client Registration, or a documented dev-only auth mode for the web simulator, would remove the biggest non-product chunk of work.
- **Latency budget:** the 500 ms limit is reasonable for voice, but guidance on patterns for slow work (for example a "working on it" follow-up) would help add-ons that need an LLM or a slow API.
- **AWS Free plan:** a clearer up-front list of which services a Free-plan account can't use would have saved time before the first `cdk deploy`.
- **What worked well:** Streamable HTTP on Lambda Function URLs needed no glue code, and DynamoDB on-demand plus EventBridge schedules are a near-perfect fit for this kind of small, bursty app.

## Friction log

| Area | What happened | Impact | Workaround |
|---|---|---|---|
| Alexa+ MCP Toolkit access | Setup needs an IAM role in Amazon's account via an Alexa Solutions Architect, plus CodeArtifact login for the CLI. No self-serve path for a solo developer. | Couldn't test on real Alexa+ on day one. | Built a simulated Alexa that calls the same MCP endpoint over Streamable HTTP. |
| Alexa+ auth | Add-ons need OAuth 2.1 + PKCE with RFC 9728 metadata; Dynamic Client Registration isn't supported yet. | An authorization server before the first call. | Optional static bearer token for self-hosting; Cognito planned. |
| Latency budget | Tool responses must return in under 500 ms. | No LLM in the live voice path. | Template answers for voice; Bedrock for the weekly report. |
| AWS account | The Free plan blocks the services the CDK stack needs. | Couldn't deploy to real AWS. | `npm run aws:local`: the real handlers against emulated DynamoDB, Function URL, EventBridge and SNS. |

The running log is kept in [`FRICTION_LOG.md`](../FRICTION_LOG.md).

## Demo video script (under 3 minutes)

1. **0:00** Title, then the problem: Mom lives alone, Sarah lives three hours away.
2. **0:15** Mom talks to Alexa: "Good morning!", "Had my oatmeal and the little white pill." Show the tool calls under each reply.
3. **0:45** The dashboard updates: check-in time, the medication ring, the meal.
4. **1:05** Sarah asks "How's Mom today?" and "Did Mom miss anything?"
5. **1:25** The missed dose: the scheduled check finds an unconfirmed dose, the alert appears, and the "Behind the scenes" card shows EventBridge, Lambda and SNS at work.
6. **1:55** "Doctor summary" opens the one-page weekly summary.
7. **2:15** Architecture diagram, and `npm run aws:local` running the same handlers locally.
8. **2:40** What's next, and the repo link.
