import { Cli } from "./cli/index.js";
import { Env } from "./env.js";
import { createInterface } from "./import.js";

const code = await Cli.run(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  cwd: process.cwd(),
  env: Env.read(),
  lines: () => createInterface({ input: process.stdin }),
  readLine: () =>
    new Promise((resolve) => {
      const lines = createInterface({ input: process.stdin });
      // Resolve before closing: `close()` fires the `close` listener at once, and that one
      // resolves with null.
      lines.once("line", (line) => {
        resolve(line);
        lines.close();
      });
      lines.once("close", () => resolve(null));
    }),
});
process.exitCode = code;
