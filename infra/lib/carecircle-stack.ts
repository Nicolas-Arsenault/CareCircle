import * as path from "node:path";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, FunctionUrlAuthType, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription, SmsSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

export interface CareCircleProps extends StackProps {
  parentName: string;
  timeZone: string;
  alertEmail?: string;
  alertPhone?: string;
  mcpAuthToken?: string;
  useBedrock: boolean;
  bedrockModel?: string;
}

const ROOT = path.join(__dirname, "..", "..");

/**
 * Everything CareCircle needs on AWS, sized for the free tier:
 * a DynamoDB table (on-demand), the MCP server on Lambda behind a Function URL,
 * a scheduled Lambda that checks for missed check-ins, and an SNS topic for family alerts.
 */
export class CareCircleStack extends Stack {
  constructor(scope: Construct, id: string, props: CareCircleProps) {
    super(scope, id, props);

    const table = new Table(this, "Table", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      // Demo data only. Switch to RETAIN before storing anything real.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const alerts = new Topic(this, "FamilyAlerts", { displayName: "CareCircle" });
    if (props.alertEmail) alerts.addSubscription(new EmailSubscription(props.alertEmail));
    if (props.alertPhone) alerts.addSubscription(new SmsSubscription(props.alertPhone));

    const environment: Record<string, string> = {
      STORE: "dynamodb",
      TABLE_NAME: table.tableName,
      NOTIFIER: "sns",
      SNS_TOPIC_ARN: alerts.topicArn,
      PARENT_NAME: props.parentName,
      CARE_TIMEZONE: props.timeZone,
      SUMMARIZER: props.useBedrock ? "bedrock" : "template",
      ...(props.bedrockModel ? { BEDROCK_MODEL_ID: props.bedrockModel } : {}),
      ...(props.mcpAuthToken ? { MCP_AUTH_TOKEN: props.mcpAuthToken } : {}),
    };

    const common = {
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      projectRoot: ROOT,
      depsLockFilePath: path.join(ROOT, "package-lock.json"),
      environment,
      bundling: { format: OutputFormat.CJS, minify: true, sourceMap: true, target: "node22" },
    };

    const logs = (name: string) =>
      new LogGroup(this, `${name}Logs`, { retention: RetentionDays.ONE_WEEK, removalPolicy: RemovalPolicy.DESTROY });

    const mcp = new NodejsFunction(this, "McpServer", {
      ...common,
      logGroup: logs("McpServer"),
      entry: path.join(ROOT, "src/lambda/mcp.ts"),
      timeout: Duration.seconds(30),
    });
    const url = mcp.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });

    const checker = new NodejsFunction(this, "MissedCheckins", {
      ...common,
      logGroup: logs("MissedCheckins"),
      entry: path.join(ROOT, "src/lambda/checker.ts"),
      timeout: Duration.seconds(60),
    });
    new Rule(this, "EveryFifteenMinutes", {
      schedule: Schedule.rate(Duration.minutes(15)),
      targets: [new LambdaFunction(checker)],
    });

    for (const fn of [mcp, checker]) {
      table.grantReadWriteData(fn);
      alerts.grantPublish(fn);
      if (props.useBedrock) {
        // The Anthropic Bedrock SDK calls the Bedrock Mantle (Messages API) endpoint.
        fn.addToRolePolicy(
          new PolicyStatement({
            actions: ["bedrock-mantle:*", "bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
            resources: ["*"],
          }),
        );
      }
    }

    new CfnOutput(this, "McpUrl", { value: `${url.url}mcp`, description: "Point Alexa+ or MCP Inspector here." });
    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "AlertTopicArn", { value: alerts.topicArn });
  }
}
