// Vehicles: the fleet list and one vehicle.
import { Router } from "express";
export const vehicles = Router();
vehicles.get("/", async (_req, res) => res.json(await db.from("vehicles").select("*")));
vehicles.get("/:id", async (req, res) => res.json(await db.from("vehicles").select("*").eq("id", req.params.id)));
