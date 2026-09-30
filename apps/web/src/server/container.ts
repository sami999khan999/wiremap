import { Env } from "~/env.js";
import { Container } from "./import.js";

// Held on `globalThis`: Vite's SSR can evaluate this module again after an edit, and a
// second container would be a second set of pools and Redis sockets beside the first.
const held = globalThis as { loadbearingContainer?: Container; loadbearingDisposal?: true };

// One per process, at module scope. Per request would open a pool per request and
// exhaust Postgres in seconds — see docs/reference/server-functions.md.
held.loadbearingContainer ??= new Container(Env.containerConfig());
export const container: Container = held.loadbearingContainer;

// Disposed once the server has finished with it (`CR.34`). srvx stops accepting on
// SIGTERM and lets requests finish; it fires no Nitro hook and does not exit.
// ──
// Disposing at the signal would close the pools under those requests, and never disposing
// leaves pools and sockets holding the process open until it is killed.
if (!held.loadbearingDisposal) {
  held.loadbearingDisposal = true;
  process.once("SIGTERM", () => {
    setTimeout(() => {
      void container.dispose();
    }, Env.shutdownGraceMs);
  });
}
