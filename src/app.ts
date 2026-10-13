import type { Config } from "./config.js";
import { CareService } from "./care.js";
import { FileStore, MemoryStore } from "./store/memory.js";
import { DynamoStore } from "./store/dynamodb.js";
import type { Store } from "./store/store.js";
import { TemplateSummarizer, type Summarizer } from "./ai/summarizer.js";
import { BedrockSummarizer } from "./ai/bedrock.js";
import { ConsoleNotifier, SnsNotifier, type Notifier } from "./notify/notifier.js";

export function createStore(config: Config): Store {
  switch (config.store) {
    case "memory":
      return new MemoryStore();
    case "file":
      return new FileStore(config.dataFile);
    case "dynamodb":
      return new DynamoStore(config.tableName, config.awsRegion);
    default:
      throw new Error(`Unknown STORE "${config.store}". Use memory, file or dynamodb.`);
  }
}

export function createSummarizer(config: Config): Summarizer {
  return config.summarizer === "bedrock"
    ? new BedrockSummarizer(config.bedrockModel, config.awsRegion)
    : new TemplateSummarizer();
}

export function createNotifier(config: Config): Notifier {
  if (config.notifier === "sns") {
    if (!config.snsTopicArn) throw new Error("NOTIFIER=sns needs SNS_TOPIC_ARN.");
    return new SnsNotifier(config.snsTopicArn, config.awsRegion);
  }
  return new ConsoleNotifier();
}

/** Wires a CareService from config: local file + templates by default, AWS services when configured. */
export function createCare(config: Config, store: Store = createStore(config)): CareService {
  return new CareService({
    config,
    store,
    summarizer: createSummarizer(config),
    notifier: createNotifier(config),
  });
}
