import express from "express";
import * as Sentry from "@sentry/node";
import { vehicles } from "./routes/vehicles";
Sentry.init({ dsn: process.env.SENTRY_DSN });
const app = express();
app.use("/vehicles", vehicles);
app.listen(3000);
