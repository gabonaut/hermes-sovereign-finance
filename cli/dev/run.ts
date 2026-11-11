// Development entry: the same commands as the shipped CLI, with the software authenticator in
// place of the browser page. For tests and testnet probes only. Refuses to run in mainnet mode.
import path from "node:path";
import { run } from "../src/main.ts";
import { softwareTransport } from "./software-authenticator.ts";

const argv = process.argv.slice(2);
const dirIndex = argv.indexOf("--data-dir");
const dataDir = dirIndex >= 0 ? argv[dirIndex + 1] : "";
const modeIndex = argv.indexOf("--mode");
if (modeIndex >= 0 && argv[modeIndex + 1] === "mainnet") {
  process.stderr.write("The development runner signs with a software key and does not run on mainnet.\n");
  process.exit(2);
}
const code = await run([...argv, ...(modeIndex >= 0 ? [] : ["--mode", "testnet"])], {
  openTransport: async (_job, log) => softwareTransport(path.join(dataDir, "dev-authenticator.json"), log),
});
process.stdout.write("", () => process.exit(code));
