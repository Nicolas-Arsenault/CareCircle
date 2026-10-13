import { App } from "aws-cdk-lib";
import { CareCircleStack } from "../lib/carecircle-stack";

const app = new App();
const ctx = (key: string) => app.node.tryGetContext(key) as string | undefined;

new CareCircleStack(app, "CareCircle", {
  parentName: ctx("parentName") ?? "Mom",
  timeZone: ctx("timeZone") ?? "America/Toronto",
  alertEmail: ctx("alertEmail"),
  alertPhone: ctx("alertPhone"),
  mcpAuthToken: ctx("mcpAuthToken"),
  useBedrock: ctx("bedrock") === "true",
  bedrockModel: ctx("bedrockModel"),
});
