// Transcodes uploaded videos from the queue.
import { Worker } from "bullmq";
new Worker("video-transcode", async (job) => job.data);
