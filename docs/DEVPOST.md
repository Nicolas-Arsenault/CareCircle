# CareCircle: Devpost submission

Short version for the Devpost form. Gallery images are in [`docs/devpost/`](devpost/), numbered in upload order.

**Elevator pitch:** An Alexa+ add-on that keeps an aging parent and their family in the loop. Mom just talks, the family can ask how she's doing, and a missed dose sends them a text.

**Built with:** typescript, node.js, model-context-protocol, alexa, aws-lambda, amazon-dynamodb, amazon-eventbridge, amazon-sns, amazon-bedrock, aws-cdk

**Try it out:** the live demo URL from Render (see the README's "Try it live"), plus https://github.com/Nicolas-Arsenault/CareCircle

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
- One codebase that runs on a laptop and on emulated AWS, with the same handlers a real Lambda deploy uses.
- A dashboard that shows the plumbing live: every MCP call, scheduled run and alert.
- Honest about health: no diagnosis, no advice, only what was logged.

## What we learned

- When an LLM routes the calls, tool names and descriptions are the UX.
- Stateless Streamable HTTP fits Lambda perfectly: no sessions, no WebSockets.
- Emulating AWS from day one meant every feature was tested against real DynamoDB behaviour.

## What's next for CareCircle

OAuth with Cognito, testing on a real Echo, per-family consent, and a gentle spoken nudge to Mom before the family is texted.

---

## Additional info (for judges)

Fields marked *(yours)* are personal, so fill them in yourself.

**Upload a file:** optional. `devpost-gallery.zip` or a zip of the repo works.

**Submitter type:** Individual *(yours, if you have teammates pick Team)*

**Organization name:** N/A

**Country of residence / Canadian province:** *(yours)*

**Primary track:** Alexa+

**Code repository:** https://github.com/Nicolas-Arsenault/CareCircle (public, MIT license)

**New or existing:** New

### AWS Builder Mini Challenge: Yes

**Which AWS services did you incorporate and how?**

CareCircle's backend is one AWS CDK stack (`infra/lib/carecircle-stack.ts`):

- **AWS Lambda + Function URL** hosts the MCP server. It uses stateless Streamable HTTP, so Alexa+ calls it directly with no API Gateway or adapter layer (`src/lambda/mcp.ts`).
- **Amazon DynamoDB** (on-demand, single table, `pk`/`sk`) stores check-ins, doses, meals, moods, reminders and sent alerts (`src/store/dynamodb.ts`).
- **Amazon EventBridge** runs a second Lambda every 15 minutes that looks for a missed 10 AM check-in or a dose more than an hour late (`src/lambda/checker.ts`).
- **Amazon SNS** texts or emails the family once per miss (`src/notify/notifier.ts`).
- **Amazon Bedrock** (Claude, via the Anthropic Bedrock SDK) can write the weekly doctor summary and can stand in for Alexa+'s model in the simulator. It falls back to templates if Bedrock is unavailable (`src/ai/bedrock.ts`, `src/alexa/simulator.ts`).
- **AWS CDK** creates all of it with one `cdk deploy`.

Our AWS account is on the Free plan, which blocks deploying this stack. `cdk synth` succeeds, and `npm run aws:local` runs the real Lambda handlers against emulated DynamoDB (dynalite), a local Function URL, an EventBridge-style timer and console SNS. The dashboard's "Behind the scenes" panel shows each service at work.

### Open Source Mini Challenge: Yes

**Contribution URL:** https://github.com/Nicolas-Arsenault/CareCircle

**Project repository URL:** https://github.com/Nicolas-Arsenault/CareCircle

**GitHub username:** Nicolas-Arsenault

**What we did, how it works, why it matters:**

We built CareCircle as a new MIT-licensed repository during the hackathon. It's a complete, runnable Alexa+ MCP add-on: an MCP server (spec 2025-11-25, Streamable HTTP) with 8 care tools, a simulated Alexa+ that calls the server over real MCP, a family dashboard, an AWS CDK stack, and an emulated-AWS mode so anyone can run the whole cloud path on a laptop with `npm install && npm run aws:local`. Tests cover the care logic, phrase routing and a full MCP round trip.

It matters because Alexa+ toolkit access is gated, so most developers can't try an add-on yet. This repo is a working template for an Alexa+ MCP add-on on AWS that runs with no special access and no AWS bill, and the care use case (an aging parent living alone) is a real need.

### Feature requests (optional)

- **Self-serve Alexa+ MCP Toolkit sandbox (Critical).** Today access needs an IAM role arranged through an Alexa Solutions Architect. A rate-limited sandbox would let solo and hackathon developers test on real Alexa+.
- **Dev-only auth for the web simulator, or Dynamic Client Registration (Important).** Add-ons need full OAuth 2.1 + PKCE before the first call. A dev mode would remove the biggest non-product task.
- **A documented pattern for slow tools under the 500 ms limit (Important).** For example a "working on it" follow-up, so tools that need an LLM or a slow API can still answer.
- **Proactive notifications from an add-on (Nice-to-have).** Letting CareCircle speak a gentle nudge to the parent before texting the family.

### Friction log (optional)

| Task attempted | Steps taken | Expected vs. actual | Severity | Workaround | Suggestion |
|---|---|---|---|---|---|
| Test the add-on on real Alexa+ | Read the MCP Toolkit quickstart and dev-environment setup | Expected a self-serve CLI login. Actually needs an IAM role in Amazon's account via a Solutions Architect, plus CodeArtifact tokens that expire every 12 hours | High | Built a simulated Alexa+ that calls the same MCP endpoint over Streamable HTTP | Offer a self-serve sandbox account |
| Secure the MCP endpoint for Alexa+ | Read the add-on auth requirements | Expected a simple dev token. Actually OAuth 2.1 + PKCE, RFC 9728 metadata, and no Dynamic Client Registration | Medium | Optional bearer token for self-hosting; Cognito planned | Dev-only auth mode for the simulator, or DCR support |
| Use an LLM for spoken summaries | Planned a Bedrock call inside a tool | Expected it to fit. The 500 ms tool budget rules it out | Medium | Fast templates for voice, Bedrock only for the weekly report | Document an async or follow-up pattern |
| Deploy the CDK stack | `cdk synth`, then `cdk deploy` on our account | Expected a deploy within the free tier. The Free plan blocks the services the stack needs | High | `npm run aws:local` emulates DynamoDB, Lambda URL, EventBridge and SNS | List Free-plan service limits up front, before the first deploy |

### Project testing link (optional)

*(your Render URL once it's live)*

### Feedback questions

**1. Which developer tools, APIs and SDKs did you use, and for what?**

- **MCP TypeScript SDK:** the MCP server, its 8 tools, and the simulator's MCP client.
- **Alexa+ MCP Toolkit docs:** designing the add-on (tool descriptions, auth and latency requirements).
- **AWS CDK:** the whole AWS stack as code.
- **AWS Lambda + Function URLs:** hosting the MCP server and the missed check-in job.
- **Amazon DynamoDB:** the care log.
- **Amazon EventBridge:** the 15-minute scheduled check.
- **Amazon SNS:** family alerts by SMS or email.
- **Amazon Bedrock (Anthropic Bedrock SDK, Claude):** weekly summaries and an AI mode for the simulated Alexa.
- **dynalite:** local DynamoDB emulation.
- **Playwright and ffmpeg:** screenshots and the demo video.

**2. What worked well?**

- **MCP SDK:** stateless Streamable HTTP worked the same on a laptop and in a Lambda handler. Zod schemas made tool inputs clear.
- **Alexa+ MCP Toolkit design:** letting Alexa+'s model choose tools from descriptions meant no intent model to maintain.
- **Lambda Function URLs:** no glue code needed for MCP.
- **DynamoDB:** on-demand single-table design fit the data, and the SDK worked unchanged against dynalite.
- **EventBridge + SNS:** a schedule and a topic were all the proactive loop needed.
- **CDK:** the whole stack in about 100 lines of TypeScript.
- **Bedrock:** the Anthropic Bedrock SDK uses the same API as the Anthropic SDK, so falling back to templates was easy.

**3. What needs work?**

- **Alexa+ MCP Toolkit:** gated access, OAuth 2.1 without DCR, and no documented pattern for work slower than 500 ms.
- **AWS Free plan:** it wasn't clear which services were blocked until deploying.

**4. How was onboarding (zero to hello world)?**

- **MCP SDK:** fast. The official examples got a tool working over HTTP quickly.
- **AWS (CDK, Lambda, DynamoDB, EventBridge, SNS):** smooth locally with the emulators. The real deploy was blocked by the account plan.
- **Alexa+ MCP Toolkit:** we couldn't reach hello world on real Alexa+, because access requires Amazon to set up an IAM role.

**5. Would you build with these devices and services again?**

Yes. Voice is the right interface for an older parent, and an MCP add-on is a clean way to give Alexa+ new skills. The AWS pieces fit the problem with very little code. We'd want self-serve toolkit access first.

### Eligibility and AI

**Age of majority, eligible jurisdiction, not a sponsor employee:** *(yours, tick if true)*

**Which AI tools have you leveraged?** Claude (Claude Code) to help write the code, tests, docs, diagrams and demo video; Claude on Amazon Bedrock inside the app for summaries.

**Level of learning:** Significant *(yours)*

**Did you gain AI value you can use in your career?** Yes *(yours)*

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
