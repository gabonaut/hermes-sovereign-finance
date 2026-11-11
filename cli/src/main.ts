// Command dispatch. Every command prints one JSON envelope on stdout; progress goes to stderr.
import { activate, createWallet, grantDraft, recoverWallet, revoke, withdraw, type AdminCtx } from "./admin.ts";
import { chainFor, chainsFor, isMode, isNetworkKey, type Mode } from "./config.ts";
import { CliError, decodeFailure } from "./errors.ts";
import { JobReporter, type JobKind } from "./job.ts";
import { presetFor } from "./policy.ts";
import { listPositions } from "./positions.ts";
import { forgetPlan, planClose, planOpen, resolveActions } from "./plans.ts";
import { listPools, quoteSwap } from "./quote.ts";
import { describeBatch, execute, status } from "./session.ts";
import { Store } from "./store.ts";
import type { WebAuthnTransport } from "./webauthn.ts";

export type Env = {
  /** How admin commands reach the user's authenticator. */
  openTransport: (job: JobReporter, log: (line: string) => void) => Promise<WebAuthnTransport>;
};

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) throw new CliError("BAD_ARGS", `Unexpected argument ${a}`);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) flags[a.slice(2)] = "true";
    else flags[a.slice(2)] = rest[++i];
  }
  return { command, flags };
}

async function readInput(flags: Record<string, string>): Promise<any> {
  if (flags.input) return JSON.parse(flags.input);
  if (process.stdin.isTTY) return {};
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

const ADMIN: Record<string, JobKind> = { create: "create", recover: "recover", activate: "activate", revoke: "revoke", withdraw: "withdraw" };

export async function run(argv: string[], env: Env): Promise<number> {
  const log = (line: string) => process.stderr.write(`${line}\n`);
  const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n`);
  let job: JobReporter | null = null;
  try {
    const { command, flags } = parseArgs(argv);
    if (!command) throw new CliError("BAD_ARGS", "Missing command.");
    const store = new Store(flags["data-dir"]);
    const input = await readInput(flags);
    const mode: Mode = isMode(flags.mode) ? flags.mode : store.mode();
    const network = flags.network ?? input?.network;
    if (network !== undefined && !isNetworkKey(network)) throw new CliError("BAD_ARGS", 'network must be "bnb" or "ethereum".');
    const ctx = { store, mode, log };

    if (command in ADMIN) {
      job = new JobReporter(store, flags.job ?? null, ADMIN[command], log);
      const adminCtx: AdminCtx = { ...ctx, job, openTransport: (j) => env.openTransport(j, log) };
      let result: unknown;
      if (command === "create") result = await createWallet(adminCtx);
      else if (command === "recover") result = await recoverWallet(adminCtx);
      else if (command === "activate") result = await activate(adminCtx, input);
      else if (command === "revoke") result = await revoke(adminCtx, { ...input, network });
      else result = await withdraw(adminCtx, { ...input, network });
      job.done(result);
      emit({ ok: true, data: result });
      return 0;
    }

    let data: unknown;
    switch (command) {
      case "mode":
        if (input?.mode !== undefined) {
          if (!isMode(input.mode)) throw new CliError("BAD_INPUT", 'mode must be "testnet" or "mainnet".');
          store.setMode(input.mode);
        }
        data = { mode: store.mode() };
        break;
      case "preset":
        data = { id: "v3-lp", title: "V3 LP", durationDays: 7, networks: Object.fromEntries(chainsFor(mode).map((c) => [c.key, presetFor(c)])) };
        break;
      case "grant":
        data = await grantDraft(ctx, input);
        break;
      case "status":
        data = await status(ctx, { network, positions: input?.positions });
        break;
      case "positions": {
        if (!network) throw new CliError("BAD_ARGS", "positions needs a network.");
        const wallet = store.wallet(mode);
        if (!wallet) throw new CliError("NO_WALLET", "There is no wallet yet. Create one in the Sovereign Finance pane.");
        const chain = chainFor(mode, network);
        data = { network, chainId: chain.chainId, positions: await listPositions(store, chain, wallet.address) };
        break;
      }
      case "quote": {
        if (!network) throw new CliError("BAD_ARGS", "quote needs a network.");
        const chain = chainFor(mode, network);
        const wallet = store.wallet(mode);
        const record = store.session(chain.chainId);
        const kind = input?.kind;
        if (kind === "pools") data = await listPools(chain, record && record.status === "active" ? record.scope : null, Math.min(Math.max(Number(input?.limit ?? 10), 1), 25));
        else if (kind === "swap") data = await quoteSwap(chain, input);
        else if (kind === "lp-plan" || kind === "exit-plan") {
          if (!wallet) throw new CliError("NO_WALLET", "There is no wallet yet. Create one in the Sovereign Finance pane.");
          const planned = kind === "lp-plan" ? await planOpen(store, chain, wallet.address, input) : await planClose(store, chain, wallet.address, input);
          data = { ...(planned.summary as object), planId: planned.planId, actions: planned.actions, next: `To run this, call sovereign_execute with {"network": "${network}", "planId": "${planned.planId}"}. The plan is kept for ten minutes.` };
        } else throw new CliError("BAD_INPUT", 'kind must be "pools", "swap", "lp-plan" or "exit-plan".');
        data = { network, chainId: chain.chainId, kind, ...(data as object) };
        break;
      }
      case "describe":
      case "execute": {
        if (!network) throw new CliError("BAD_ARGS", `${command} needs a network.`);
        const wallet = store.wallet(mode);
        if (!wallet) throw new CliError("NO_WALLET", "There is no wallet yet. Create one in the Sovereign Finance pane.");
        const batch = await resolveActions(store, chainFor(mode, network), wallet.address, input);
        if (command === "describe") data = { ...describeBatch(ctx, { network, actions: batch.actions }), planId: batch.planId };
        else {
          const result: any = await execute(ctx, { network, actions: batch.actions });
          if (result?.ok) forgetPlan(store, batch.planId);
          data = result;
        }
        break;
      }
      default:
        throw new CliError("BAD_ARGS", `Unknown command "${command}".`);
    }
    emit({ ok: true, data });
    return 0;
  } catch (e) {
    const f = decodeFailure(e);
    if (!(e instanceof CliError)) log(`error: ${f.raw}`);
    job?.fail(f.code, f.message);
    emit({ ok: false, error: { code: f.code, message: f.message, revert: f.revert, relayCode: f.relayCode, ...(e instanceof CliError ? e.extra : {}) } });
    return 1;
  }
}
