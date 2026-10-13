# Connecting CareCircle to Alexa+

Researched October 2026 from Amazon's developer docs. Check the linked pages for changes.

## How Alexa+ talks to an MCP server

Alexa+ reaches third-party MCP servers through the **Alexa+ MCP Toolkit** ([overview](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html), [quickstart](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html)). Alexa+'s own model reads your tool list and decides which tools to call, so there's no intent model to write.

The flow:

1. Host the MCP server at a public HTTPS URL. For local work, a tunnel such as `cloudflared tunnel --url http://127.0.0.1:3000` is fine.
2. Install the Alexa AI CLI (`npm install -g @alexa-ai/cli`) and sign in with `alexa-ai configure`.
3. `alexa-ai new mcp --name "CareCircle" --locale en-US --mcp-server-url https://…/mcp` creates `addon-package/addon.json`. Fill in descriptions, 3 to 4 example phrases, privacy and terms URLs, icons in six sizes and a 600x900 carousel image.
4. `alexa-ai deploy` puts the add-on in the development stage.
5. Test in the **web simulator** at `developer.amazon.com/alexa/console/ask/addons/simulator`, typing utterances in Isolation mode ([guide](https://developer.amazon.com/docs/alexaplus/add-ons/test-with-web-simulator.html)). A physical Echo is optional.
6. Re-run `alexa-ai deploy` after changing tools; Alexa+ only refreshes the tool list on deploy.

## Requirements, and where CareCircle stands

| Requirement | CareCircle |
|---|---|
| Streamable HTTP transport (spec 2025-11-25) | Done. Stateless JSON mode, local and on Lambda |
| Public HTTPS URL | Lambda Function URL from `infra/`, or a tunnel |
| Round trip under 500 ms | Template summaries and DynamoDB reads are fast. Bedrock summaries are not; keep `SUMMARIZER=template` for the live Alexa path |
| OAuth 2.1 authorization code + PKCE (S256), RFC 9728 protected resource metadata, `/.well-known/oauth-authorization-server`, 401 without `WWW-Authenticate` | **Not yet.** Only an optional static bearer token (`MCP_AUTH_TOKEN`). This is the main gap for a real add-on. Amazon Cognito can act as the authorization server |
| Visual output via MCP Apps | Optional; CareCircle is voice-only |

## The catch: access

The [development environment setup](https://developer.amazon.com/docs/alexaplus/add-ons/set-up-your-development-environment.html) needs more than a free developer account:

- an IAM user that can assume the `AddOn3PDeveloperToolsRead` role in Amazon's AWS account, set up through your **Alexa Solutions Architect**;
- CodeArtifact access to install the CLI (tokens expire every 12 hours);
- an Amazon account whose marketplace and locale support Alexa+.

So the real Alexa+ path depends on Amazon granting toolkit access, and that's outside our control. Ask the hackathon organizers whether participants get it.

## Demo plan

1. **Default:** the simulated Alexa in this repo (`npm run dev`). The rules allow "simulated Alexa+ experiences", and the simulator calls the real MCP server over Streamable HTTP, showing each tool call on screen.
2. **If toolkit access comes through:** add OAuth, deploy with `infra/`, register with `alexa-ai`, and record the web simulator or an Echo for the video.
3. **Middle ground:** [alexa-skill-mcp-bridge](https://github.com/KayLerch/alexa-skill-mcp-bridge) puts an MCP server on a physical Alexa device today, using a classic Alexa Skill plus an agent on Bedrock AgentCore that stands in for the Alexa+ orchestrator. It needs your own AWS account.
