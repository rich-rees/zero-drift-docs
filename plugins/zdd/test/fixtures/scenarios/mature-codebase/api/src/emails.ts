// Sends the emails queued by the API.
import { Worker } from "bullmq";
new Worker("emails", async (job) => job.data);
