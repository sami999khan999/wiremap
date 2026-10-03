import { Cli } from "./cli/index.js";

const code = await Cli.run(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  cwd: process.cwd(),
});
process.exitCode = code;
