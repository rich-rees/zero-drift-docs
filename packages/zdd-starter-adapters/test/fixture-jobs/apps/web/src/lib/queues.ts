import { Queue } from "bullmq";
export const videoQueue = new Queue("video-transcode");
