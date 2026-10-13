# CareCircle: Devpost submission

Short version for the Devpost form. Gallery images are in [`docs/devpost/`](devpost/), numbered in upload order.

**Elevator pitch:** An Alexa+ add-on that keeps an aging parent and their family in the loop. Mom just talks, the family can ask how she's doing, and a missed dose sends them a text.

**Built with:** typescript, node.js, model-context-protocol, alexa, aws-lambda, amazon-dynamodb, amazon-eventbridge, amazon-sns, amazon-bedrock, aws-cdk

**Try it out:** https://github.com/Nicolas-Arsenault/CareCircle

**Video:** upload `docs/video/carecircle-motion.mp4` to YouTube and paste the link.

---

## About the project

## Inspiration

Mom lives alone. Her daughter Sarah lives three hours away and wants to know she's okay without calling five times a day. Mom already talks to the Echo in her kitchen, so we made that the whole interface.

## What it does

- **Mom just talks.** "Good morning, had my oatmeal and the little white pill." Alexa+ turns that into a logged check-in, dose and meal. No commands to learn.
- **The family stays in the loop.** A live dashboard, and Sarah can ask Alexa "How's Mom today?"
- **It notices what didn't happen.** No check-in by 10 AM, or a dose an hour late, and the family gets one text.
- **One page for the doctor.** A weekly summary of doses, mood and anything worth raising. It reports what was logged and gives no medical advice.

## How we built it

An MCP server (spec 2025-11-25, Streamable HTTP) with 8 tools, built with the TypeScript MCP SDK. It runs on AWS Lambda behind a Function URL, stores everything in DynamoDB, checks for misses with EventBridge every 15 minutes, texts the family through SNS, and can write summaries with Claude on Amazon Bedrock. One CDK stack deploys it all, and `npm run aws:local` runs the same handlers against emulated AWS on a laptop.

## Challenges we ran into

Alexa+ MCP Toolkit access goes through an Amazon Solutions Architect, add-ons need full OAuth 2.1, and our Free-plan AWS account can't deploy. So we built a simulated Alexa that calls the real MCP endpoint, and an emulated AWS mode that runs the real Lambda code.

## Accomplishments that we're proud of

- The proactive loop: CareCircle notices what *didn't* happen and tells the family once.
- One codebase that runs on a laptop, on emulated AWS and on real Lambda, with the same handlers.
- A dashboard that shows the plumbing live: every MCP call, scheduled run and alert.
- Honest about health: no diagnosis, no advice, only what was logged.

## What we learned

- When an LLM routes the calls, tool names and descriptions are the UX.
- Stateless Streamable HTTP fits Lambda perfectly: no sessions, no WebSockets.
- Emulating AWS from day one meant every feature was tested against real DynamoDB behaviour.

## What's next for CareCircle

OAuth with Cognito, testing on a real Echo, per-family consent, and a gentle spoken nudge to Mom before the family is texted.

---

## Other fields

**AWS Builder:** Lambda + Function URL, DynamoDB, EventBridge, SNS and Bedrock, defined in one CDK stack (`infra/`). It synthesizes; deploying is blocked by our Free-plan account, so the demo runs the same handlers under `npm run aws:local`.

**Open source:** MIT, https://github.com/Nicolas-Arsenault/CareCircle. Runs with `npm install && npm run dev`, no cloud account needed.

**Product feedback:** A self-serve Alexa+ toolkit sandbox and a dev-only auth mode would let solo builders test on real Alexa+. Streamable HTTP on Lambda Function URLs needed no glue code.

**Friction log:** toolkit access, OAuth 2.1 before the first call, the 500 ms tool budget, and the Free-plan deploy block. Details in [`FRICTION_LOG.md`](../FRICTION_LOG.md).

---

## Image gallery

3:2 images, ready to upload in this order:

| # | File | Caption |
|---|---|---|
| 1 | `devpost/01-title.jpg` | CareCircle: Alexa+ keeps an aging parent and their family in the loop. |
| 2 | `devpost/02-mom-talks.jpg` | Mom just talks. Alexa+ picks the CareCircle tools. |
| 3 | `devpost/03-dashboard.jpg` | The demo app: a simulated Alexa and the family dashboard. |
| 4 | `devpost/04-sarah-asks.jpg` | Sarah asks how Mom is doing. |
| 5 | `devpost/05-missed-dose.jpg` | A missed dose becomes one text to the family. |
| 6 | `devpost/06-doctor-summary.jpg` | A one-page weekly summary for the doctor. |
| 7 | `devpost/07-architecture.jpg` | Architecture: MCP server on Lambda, DynamoDB, EventBridge, SNS, Bedrock. |
| 8 | `devpost/08-behind-the-scenes.jpg` | Emulated AWS at work in the app. |
