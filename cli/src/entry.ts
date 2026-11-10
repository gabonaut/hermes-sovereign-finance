// The shipped entry point: admin signatures go through the passkey page in the user's browser.
import { browserTransport } from "./bridge.ts";
import { run } from "./main.ts";

process.exitCode = await run(process.argv.slice(2), { openTransport: (job, log) => browserTransport(job, log) });
