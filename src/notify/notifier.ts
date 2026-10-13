import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { record } from "../activity.js";

/** Delivers a message to the family. */
export interface Notifier {
  send(subject: string, message: string): Promise<void>;
}

/** Prints to the server log. The family page also shows every alert, so this is enough for demos. */
export class ConsoleNotifier implements Notifier {
  async send(subject: string, message: string): Promise<void> {
    console.log(`[notify] ${subject}: ${message}`);
    record("Alert", `${subject}: ${message}`);
  }
}

/** Publishes to an SNS topic; family members subscribe by SMS or email. */
export class SnsNotifier implements Notifier {
  private readonly sns: SNSClient;

  constructor(private readonly topicArn: string, region: string) {
    this.sns = new SNSClient({ region });
  }

  async send(subject: string, message: string): Promise<void> {
    await this.sns.send(
      new PublishCommand({ TopicArn: this.topicArn, Subject: subject.slice(0, 100), Message: message }),
    );
  }
}
