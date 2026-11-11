// Keeps relay replies readable by the SDK.
//
// A relay reply to a prepared batch lists the asset movements the batch would cause. An entry
// without a symbol is not part of the reply format the SDK reads, and this plugin never uses the
// list, so such entries are removed before the SDK parses the reply. The digest, the context and
// the typed data that get signed are not touched.

/** Remove asset movements that have no symbol. Returns true when something was removed. */
export function dropUnnamedAssetDiffs(result: any): boolean {
  const diffs = result?.capabilities?.assetDiffs;
  if (!diffs || typeof diffs !== "object") return false;
  let changed = false;
  for (const rows of Object.values(diffs)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!Array.isArray(row) || !Array.isArray(row[1])) continue;
      const kept = row[1].filter((entry: any) => typeof entry?.symbol === "string");
      if (kept.length !== row[1].length) {
        row[1] = kept;
        changed = true;
      }
    }
  }
  return changed;
}

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return String((input as { url?: string } | null)?.url ?? "");
}

const origins = new Set<string>();
let installed = false;

/**
 * Wrap fetch once so replies from the given relays pass through dropUnnamedAssetDiffs. Replies
 * from any other host, failed replies and replies that are not JSON are returned as they came.
 */
export function installRelayCompat(relayUrls: string[]): void {
  for (const u of relayUrls) origins.add(new URL(u).origin);
  if (installed) return;
  installed = true;
  const inner = globalThis.fetch;
  globalThis.fetch = async (input: any, init?: any) => {
    const response = await inner(input, init);
    try {
      if (!response.ok || !origins.has(new URL(urlOf(input)).origin)) return response;
      const payload = await response.clone().json();
      let changed = false;
      for (const item of Array.isArray(payload) ? payload : [payload]) {
        if (dropUnnamedAssetDiffs(item?.result)) changed = true;
      }
      if (!changed) return response;
      const headers = new Headers(response.headers);
      for (const name of ["content-length", "content-encoding", "transfer-encoding"]) headers.delete(name);
      return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
    } catch {
      return response;
    }
  };
}
