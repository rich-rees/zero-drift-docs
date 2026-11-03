// `node --import <this file>`: registers kit-resolve.mjs, so `@rich-rees/zdd`
// is this engine's kit in every test file `zdd-engine test` runs.
import { register } from "node:module";

if (typeof register !== "function") throw new Error("zdd-engine test needs Node 20.6 or later (node:module register)");
register("./kit-resolve.mjs", import.meta.url);
