import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Alert, CareEvent, Reminder } from "../types.js";
import type { Store } from "./store.js";

/**
 * Single-table layout:
 *   pk = CIRCLE#<circleId>
 *   sk = EVENT#<iso time>#<id> | REMINDER#<id> | ALERT#<key>
 * Every read is a Query on one partition, so on-demand billing stays near zero.
 */
export class DynamoStore implements Store {
  private readonly doc: DynamoDBDocumentClient;

  constructor(private readonly table: string, region: string) {
    this.doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  private pk(circleId: string): string {
    return `CIRCLE#${circleId}`;
  }

  private async query<T>(circleId: string, from: string, to: string): Promise<T[]> {
    const items: T[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const out = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: "pk = :pk AND sk BETWEEN :from AND :to",
          ExpressionAttributeValues: { ":pk": this.pk(circleId), ":from": from, ":to": to },
          ExclusiveStartKey: start,
        }),
      );
      for (const item of out.Items ?? []) {
        const { pk: _pk, sk: _sk, ...rest } = item;
        items.push(rest as T);
      }
      start = out.LastEvaluatedKey;
    } while (start);
    return items;
  }

  async addEvent(event: CareEvent): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: this.pk(event.circleId), sk: `EVENT#${event.at}#${event.id}`, ...event },
      }),
    );
  }

  async listEvents(circleId: string, from: string, to: string): Promise<CareEvent[]> {
    const events = await this.query<CareEvent>(circleId, `EVENT#${from}`, `EVENT#${to}`);
    return events.filter((e) => e.at >= from && e.at < to);
  }

  async addReminder(reminder: Reminder): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: this.pk(reminder.circleId), sk: `REMINDER#${reminder.id}`, ...reminder },
      }),
    );
  }

  async listReminders(circleId: string): Promise<Reminder[]> {
    return this.query<Reminder>(circleId, "REMINDER#", "REMINDER#￿");
  }

  async deleteReminder(circleId: string, id: string): Promise<boolean> {
    const out = await this.doc.send(
      new DeleteCommand({
        TableName: this.table,
        Key: { pk: this.pk(circleId), sk: `REMINDER#${id}` },
        ReturnValues: "ALL_OLD",
      }),
    );
    return Boolean(out.Attributes);
  }

  async getAlert(circleId: string, key: string): Promise<Alert | undefined> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { pk: this.pk(circleId), sk: `ALERT#${key}` } }),
    );
    if (!out.Item) return undefined;
    const { pk: _pk, sk: _sk, ...rest } = out.Item;
    return rest as Alert;
  }

  async putAlert(alert: Alert): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { pk: this.pk(alert.circleId), sk: `ALERT#${alert.key}`, ...alert },
      }),
    );
  }

  async listAlerts(circleId: string, since: string): Promise<Alert[]> {
    const all = await this.query<Alert>(circleId, "ALERT#", "ALERT#￿");
    return all.filter((a) => a.sentAt >= since).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  }
}
