// Spawns a built app and resolves when its own output says the socket is open.
//
// Extracted from `boot-smoke.mjs` so `apps/web`'s smoke suite boots a server the same
// way CI does, rather than growing a second copy of the same thirty lines that drifts.

// @ts-check

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";

// A port the kernel just handed out and nothing else holds, rather than a constant that
// collides with the dev server a developer left running.
export function freePort() {
  return new Promise((keep, drop) => {
    const socket = createServer();
    socket.on("error", drop);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      const port = typeof address === "object" && address ? address.port : 0;
      socket.close(() => keep(port));
    });
  });
}

/**
 * Resolves when `started` appears in the child's output, or — when `ready` is given —
 * when that predicate first answers true. Prefer `ready` where there is a socket to
 * poll: a log line is a proxy for the thing, and under a test runner the child's pipes
 * are not always the caller's to read.
 *
 * @param {{
 *   entry: string,
 *   started?: string,
 *   ready?: () => Promise<boolean>,
 *   cwd: string,
 *   env: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 *   onOutput?: (chunk: string) => void,
 * }} options
 */
export function bootApp(options) {
  // No default: a helper that silently inherits the caller's environment is how a
  // child ends up with half a configuration and no line saying which half.
  const { entry, started, ready, cwd, env, timeoutMs = 60_000, onOutput } = options;

  if (!started && !ready) {
    return Promise.reject(new Error("bootApp needs one of `started` or `ready`"));
  }

  if (!existsSync(entry)) {
    return Promise.reject(new Error(`${entry} does not exist — build it first`));
  }

  const child = spawn(process.execPath, [entry], { cwd, stdio: ["ignore", "pipe", "pipe"], env });

  return new Promise((keep, drop) => {
    let output = "";
    let settled = false;
    /** @type {ReturnType<typeof setInterval> | undefined} */
    let poll;

    // Killed on both paths. A child left running holds the port and the next run of the
    // suite fails somewhere else entirely.
    /** @param {NodeJS.Signals} [signal] */
    const stop = (signal = "SIGTERM") => {
      if (child.exitCode === null) child.kill(signal);
    };

    const fail = (why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      stop("SIGKILL");
      drop(new Error(`${why}${output.trim() ? `\n${output.trim()}` : ""}`));
    };

    const why = ready ? "never became ready" : `no \`${started}\``;
    const timer = setTimeout(() => fail(`${why} within ${timeoutMs / 1_000}s`), timeoutMs);

    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      keep({ child, stop, output: () => output });
    };

    // Polled rather than awaited once: the socket opens some time after the process
    // does, and every failed probe before that is expected rather than an error.
    poll = ready
      ? setInterval(() => {
          void ready().then(
            (up) => up && settle(),
            () => {},
          );
        }, 250)
      : undefined;

    const read = (chunk) => {
      const text = String(chunk);
      output += text;
      onOutput?.(text);

      // On the *first* sighting only: the line is printed once, but a consumer could log
      // something containing it and settle this promise twice.
      if (!settled && started && output.includes(started)) settle();
    };

    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", (error) => fail(`could not spawn — ${error.message}`));
    child.on("exit", (code, signal) => fail(`exited during boot (code ${code}, signal ${signal})`));
  });
}
