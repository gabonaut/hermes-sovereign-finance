// The shipped entry point: admin signatures go through the passkey page in the user's browser.
import { browserTransport } from "./bridge.ts";
import { run } from "./main.ts";

const code = await run(process.argv.slice(2), { openTransport: (job, log) => browserTransport(job, log) });
// Exit as soon as the result is written, so a connection a client library left open cannot keep the process alive.
process.stdout.write("", () => process.exit(code));
