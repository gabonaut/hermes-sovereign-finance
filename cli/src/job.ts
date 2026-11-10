// Progress of a long admin command, written to the data directory so the backend and the pane can follow it.
import type { Store } from "./store.ts";

export type JobKind = "create" | "recover" | "activate" | "revoke" | "withdraw";
export type JobState = {
  id: string;
  kind: JobKind;
  status: "running" | "waiting_passkey" | "done" | "error";
  step: string;
  passkeyUrl: string | null;
  passkeyPrompt: string | null;
  result: unknown;
  error: { code: string; message: string } | null;
  startedAt: string;
  finishedAt: string | null;
  pid: number;
};

export class JobReporter {
  private state: JobState | null;
  private url: string | null = null;
  private store: Store;
  private log: (line: string) => void;
  constructor(store: Store, id: string | null, kind: JobKind, log: (line: string) => void) {
    this.store = store;
    this.log = log;
    this.state = id
      ? { id, kind, status: "running", step: "Starting", passkeyUrl: null, passkeyPrompt: null, result: null, error: null, startedAt: new Date().toISOString(), finishedAt: null, pid: process.pid }
      : null;
    this.write();
  }
  private write() {
    if (this.state) this.store.writeJson(`jobs/${this.state.id}.json`, this.state);
  }
  private patch(p: Partial<JobState>) {
    if (this.state) Object.assign(this.state, p);
    this.write();
  }
  step(text: string) {
    this.log(text);
    this.patch({ step: text, status: "running", passkeyPrompt: null });
  }
  setPasskeyUrl(url: string) {
    this.url = url;
    this.log(`Passkey page: ${url}`);
  }
  waitingPasskey(prompt: string) {
    this.log(`Waiting for passkey: ${prompt}`);
    this.patch({ status: "waiting_passkey", passkeyUrl: this.url, passkeyPrompt: prompt });
  }
  answered() {
    this.patch({ status: "running", passkeyPrompt: null });
  }
  done(result: unknown) {
    this.patch({ status: "done", step: "Done", result, passkeyUrl: null, passkeyPrompt: null, finishedAt: new Date().toISOString() });
  }
  fail(code: string, message: string) {
    this.patch({ status: "error", step: "Failed", error: { code, message }, passkeyUrl: null, passkeyPrompt: null, finishedAt: new Date().toISOString() });
  }
}
