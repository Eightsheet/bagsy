import { and, desc, eq, inArray } from "drizzle-orm";
import {
  MAX_CLAIM_EVENTS,
  RECENT_CLAIM_EVENTS,
  type ClaimEvent,
  type ClaimEventKind,
} from "@bagsy/shared";
import { db } from "../db/client.js";
import { claimEvents } from "../db/schema.js";
import { newId } from "./crypto.js";

export interface RecordEventInput {
  claimId: string;
  orgId: string;
  kind: ClaimEventKind;
  message?: string | null;
  userId?: string | null;
  actorName?: string | null;
  meta?: Record<string, unknown> | null;
}

function toEvent(row: typeof claimEvents.$inferSelect): ClaimEvent {
  return {
    id: row.id,
    claimId: row.claimId,
    kind: row.kind as ClaimEventKind,
    message: row.message,
    actorName: row.actorName,
    meta: row.meta ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Drop everything past the newest MAX_CLAIM_EVENTS so a chatty agent cannot grow a claim unbounded. */
async function prune(claimId: string) {
  const stale = await db
    .select({ id: claimEvents.id })
    .from(claimEvents)
    .where(eq(claimEvents.claimId, claimId))
    .orderBy(desc(claimEvents.createdAt))
    .offset(MAX_CLAIM_EVENTS);
  if (stale.length > 0) {
    await db.delete(claimEvents).where(
      inArray(
        claimEvents.id,
        stale.map((r) => r.id),
      ),
    );
  }
}

/**
 * Append a timeline entry. A repeated note identical to the claim's newest
 * entry is dropped — agents heartbeat on a timer and would otherwise fill the
 * log with the same line.
 */
export async function recordClaimEvent(input: RecordEventInput): Promise<ClaimEvent | null> {
  const message = input.message?.trim() || null;

  const [newest] = await db
    .select({ kind: claimEvents.kind, message: claimEvents.message })
    .from(claimEvents)
    .where(eq(claimEvents.claimId, input.claimId))
    .orderBy(desc(claimEvents.createdAt))
    .limit(1);
  if (newest && newest.kind === input.kind && newest.message === message) {
    return null;
  }

  const [row] = await db
    .insert(claimEvents)
    .values({
      id: newId("evt"),
      claimId: input.claimId,
      orgId: input.orgId,
      userId: input.userId ?? null,
      actorName: input.actorName ?? null,
      kind: input.kind,
      message,
      meta: input.meta ?? null,
    })
    .returning();

  await prune(input.claimId);
  return toEvent(row!);
}

/** Best-effort variant: the timeline must never break the operation it describes. */
export async function recordClaimEventSafe(input: RecordEventInput): Promise<void> {
  try {
    await recordClaimEvent(input);
  } catch {
    // history is supporting data, not the transaction
  }
}

export async function listClaimEvents(claimId: string): Promise<ClaimEvent[]> {
  const rows = await db
    .select()
    .from(claimEvents)
    .where(eq(claimEvents.claimId, claimId))
    .orderBy(claimEvents.createdAt);
  return rows.map(toEvent);
}

/**
 * Newest-last tail plus total count per claim, in one query for the whole board.
 */
export async function recentEventsByClaim(
  orgId: string,
  claimIds: string[],
): Promise<Map<string, { events: ClaimEvent[]; count: number }>> {
  const out = new Map<string, { events: ClaimEvent[]; count: number }>();
  if (claimIds.length === 0) return out;

  const rows = await db
    .select()
    .from(claimEvents)
    .where(and(eq(claimEvents.orgId, orgId), inArray(claimEvents.claimId, claimIds)))
    .orderBy(claimEvents.createdAt);

  for (const row of rows) {
    const entry = out.get(row.claimId) ?? { events: [], count: 0 };
    entry.events.push(toEvent(row));
    entry.count += 1;
    out.set(row.claimId, entry);
  }
  for (const entry of out.values()) {
    entry.events = entry.events.slice(-RECENT_CLAIM_EVENTS);
  }
  return out;
}
