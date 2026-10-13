# Friction log

Notes on what was hard while building CareCircle, for the hackathon's friction-log bonus. Add an entry whenever something slows you down.

| Date | Area | What happened | Impact | Workaround |
|---|---|---|---|---|
| 2026-10-13 | Alexa+ MCP Toolkit access | Setup requires an IAM role in Amazon's account, arranged through an Alexa Solutions Architect, plus CodeArtifact login for the CLI. No self-serve path for a solo developer was documented. | Couldn't test on real Alexa+ on day one. | Built a simulated Alexa that calls the same MCP endpoint over Streamable HTTP. |
| 2026-10-13 | Alexa+ auth | Add-ons need full OAuth 2.1 + PKCE with RFC 9728 metadata, and Dynamic Client Registration isn't supported yet. A hackathon prototype has to stand up an authorization server before Alexa+ will call it. | Extra work unrelated to the product. | Optional static bearer token for self-hosting; OAuth planned via Cognito. |
| 2026-10-13 | Latency budget | Tool responses must return in under 500 ms, which rules out calling an LLM inside a tool for the live Alexa path. | Bedrock summaries can't be used on the voice path. | Deterministic template summaries by default; Bedrock for the web page and weekly report. |
