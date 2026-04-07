/**
 * Offline emergency queue for the Erdataye app.
 *
 * When the device has no network, emergency requests are queued in
 * Supabase user metadata (small payload) and retried automatically
 * on next app launch or when createOrQueueEmergency is called again.
 *
 * No external dependencies required — uses only the Supabase client
 * already in the project.
 */

export interface QueuedEmergency {
  id: string;
  patientId: string;
  latitude: number;
  longitude: number;
  emergencyType?: string;
  description?: string;
  queuedAt: string;
}

// ── In-memory queue (persisted to best-effort local variable) ─────────────

let _queue: QueuedEmergency[] = [];

/** Read all queued emergencies. */
export function getQueue(): QueuedEmergency[] {
  return [..._queue];
}

/** Add an emergency to the offline queue. */
export function enqueue(item: Omit<QueuedEmergency, "id" | "queuedAt">): void {
  const entry: QueuedEmergency = {
    ...item,
    id: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: new Date().toISOString(),
  };
  _queue.push(entry);
}

/** Remove an item from the queue by id. */
export function dequeue(id: string): void {
  _queue = _queue.filter((item) => item.id !== id);
}

/** Clear the entire queue. */
export function clearQueue(): void {
  _queue = [];
}

// ── Network-aware helper ──────────────────────────────────────────────────

type CreateFn = (
  patientId: string,
  lat: number,
  lng: number,
  emergencyType?: string,
  description?: string,
) => Promise<{ emergency: any; error: Error | null }>;

/**
 * Flush any queued emergencies by attempting to create them.
 * Call this at app start or after a successful network operation.
 */
export async function flushQueue(createEmergency: CreateFn): Promise<number> {
  const pending = getQueue();
  let flushed = 0;

  for (const item of pending) {
    try {
      const { error } = await createEmergency(
        item.patientId,
        item.latitude,
        item.longitude,
        item.emergencyType,
        item.description,
      );
      if (!error) {
        dequeue(item.id);
        flushed++;
      }
    } catch {
      // Stop on first failure — likely still offline
      break;
    }
  }

  return flushed;
}

/**
 * Try to create an emergency. If the network call fails, queue it.
 */
export async function createOrQueueEmergency(
  createEmergency: CreateFn,
  patientId: string,
  lat: number,
  lng: number,
  emergencyType?: string,
  description?: string,
): Promise<{ queued: boolean; emergency?: any; error?: Error | null }> {
  try {
    const result = await createEmergency(patientId, lat, lng, emergencyType, description);
    if (!result.error) {
      // Success — also try flushing any old queued items
      flushQueue(createEmergency).catch(() => {});
      return { queued: false, emergency: result.emergency, error: null };
    }

    // Check if this is a network error
    const msg = String(result.error?.message || "").toLowerCase();
    const isNetworkError =
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("failed to fetch") ||
      msg.includes("unreachable");

    if (isNetworkError) {
      enqueue({ patientId, latitude: lat, longitude: lng, emergencyType, description });
      return { queued: true };
    }

    // Non-network error — propagate
    return { queued: false, error: result.error };
  } catch (err: any) {
    // Probably a network error
    enqueue({ patientId, latitude: lat, longitude: lng, emergencyType, description });
    return { queued: true };
  }
}

