// Queue consumers and producers, one per library the queue readers know.
import { inngest } from "./client";
import { task, schedules } from "@trigger.dev/sdk/v3";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

export const syncUser = inngest.createFunction({ id: "sync-user" }, { event: "user/created" }, async () => {});
export const renderPdf = task({ id: "render-pdf", run: async () => {} });
export const daily = schedules.task({ id: "daily", cron: "0 1 * * *", run: async () => {} });

const sqs = new SQSClient({});
export async function sendEmail() {
  const QueueUrl = "https://sqs.eu-west-1.amazonaws.com/123/emails";
  await sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: "{}" }));
}
