// OWNER: gameplay-engineer (IDEA-019 accounts)
//
// Pushes local profile changes to the server, serialised and self-healing.
//
// The contract with profileStore.ts: a write mutates the cache synchronously
// (so the HUD updates on the same frame) and calls one of the enqueue*
// functions here. This module then reconciles with the server in the
// background, replacing the cache with whatever the server says is true.
//
// Serialised on purpose. Two concurrent purchases could otherwise race and land
// in either order, and the second response would clobber the first's result —
// a player could watch a skin they just bought disappear. One in flight at a
// time makes the last response always the most recent truth.

import {
  equipRemote,
  purchaseRemote,
  fetchProfile,
  setControlSchemeRemote,
  type EquipPayload,
  type PurchaseKind,
  type ServerProfile,
} from "./endpoints.js";
import { ApiError } from "./api.js";
import { replaceProfileCache } from "../game/profileCache.js";
import { fromServerProfile } from "../game/profileMapping.js";

type Job = () => Promise<void>;

const queue: Job[] = [];
let draining = false;

/** Syncing is disabled when there is no API to sync to.
 *
 *  That is exactly the headless-test case: scripts/test-cosmetics.ts imports
 *  profileStore (which enqueues on every write) with no VITE_API_URL, and
 *  without this guard every buy/equip assertion would spawn a doomed retry
 *  chain and spray warnings over the test output — noise that would hide a real
 *  failure. In the browser this is always configured; main.ts refuses to boot
 *  otherwise. */
function syncEnabled(): boolean {
  try {
    return Boolean(import.meta.env?.VITE_API_URL);
  } catch {
    return false;
  }
}

/** Surfaced to the UI so it can show a "not saving" banner. */
export type SyncStatus = "idle" | "syncing" | "offline" | "error";

let status: SyncStatus = "idle";
const statusListeners = new Set<(s: SyncStatus) => void>();

export function onSyncStatus(fn: (s: SyncStatus) => void): () => void {
  statusListeners.add(fn);
  fn(status);
  return () => statusListeners.delete(fn);
}

function setStatus(next: SyncStatus): void {
  if (status === next) return;
  status = next;
  for (const fn of statusListeners) fn(next);
}

export function getSyncStatus(): SyncStatus {
  return status;
}

function adopt(profile: ServerProfile): void {
  replaceProfileCache(fromServerProfile(profile));
}

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 600;

async function runWithRetry(job: Job): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await job();
      setStatus("idle");
      return;
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null;

      // A 4xx is the server's considered answer — retrying sends the same
      // rejected request again. Resync instead so the cache stops disagreeing
      // with reality (e.g. an optimistic purchase the server refused).
      if (apiErr && !apiErr.isNetworkError && apiErr.status < 500) {
        console.warn(`[sync] rejected: ${apiErr.code} — ${apiErr.message}`);
        await resyncQuietly();
        setStatus("error");
        return;
      }

      if (attempt === MAX_ATTEMPTS) {
        console.warn("[sync] giving up after retries:", err);
        setStatus("offline");
        return;
      }

      // Exponential backoff — 600ms, 1200ms.
      await new Promise((resolve) =>
        setTimeout(resolve, BASE_BACKOFF_MS * attempt),
      );
    }
  }
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  setStatus("syncing");

  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      await runWithRetry(job);
    }
  } finally {
    draining = false;
  }
}

function enqueue(job: Job): void {
  if (!syncEnabled()) return;
  queue.push(job);
  void drain();
}

/** Pull the server's profile and adopt it, swallowing failures. Used to
 *  recover from a rejected optimistic write. */
async function resyncQuietly(): Promise<void> {
  try {
    const { profile } = await fetchProfile();
    adopt(profile);
  } catch {
    // Already in a failure path; the cache stays as-is and the next successful
    // sync will correct it.
  }
}

// --- public API -------------------------------------------------------------

export function enqueueEquip(payload: EquipPayload): void {
  enqueue(async () => {
    const { profile } = await equipRemote(payload);
    adopt(profile);
  });
}

/** IDEA-038: persist the control scheme. */
export function enqueueControlScheme(scheme: "swipe" | "dpad"): void {
  enqueue(async () => {
    const { profile } = await setControlSchemeRemote(scheme);
    adopt(profile);
  });
}

export function enqueuePurchase(kind: PurchaseKind, id: string): void {
  enqueue(async () => {
    const { profile } = await purchaseRemote(kind, id);
    adopt(profile);
  });
}

/** Force a read from the server. Returns true if the cache was refreshed. */
export async function refreshProfile(): Promise<boolean> {
  try {
    const { profile } = await fetchProfile();
    adopt(profile);
    setStatus("idle");
    return true;
  } catch {
    setStatus("offline");
    return false;
  }
}

/** Wait for the queue to empty. Used before sign-out and before deleting an
 *  account, so a pending write can't fire against a dead session. */
export async function flushSync(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while ((queue.length > 0 || draining) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Drop anything pending — on sign-out, where the queued writes belong to a
 *  session that no longer exists. */
export function clearSyncQueue(): void {
  queue.length = 0;
  setStatus("idle");
}
