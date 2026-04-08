/**
 * Offline emergency queue for the Erdataye app.
 *
 * When the device has no network, emergency requests are queued and persisted
 * in AsyncStorage, then retried automatically.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export interface QueuedEmergency {
  id: string;
  patientId: string;
  latitude: number;
  longitude: number;
  emergencyType?: string;
  description?: string;
  queuedAt: string;
}

const OFFLINE_QUEUE_KEY = "erdataye.offline.emergency.queue.v1";

let _queue: QueuedEmergency[] = [];
let _hydrated = false;

async function hydrateQueue(): Promise<void> {
  if (_hydrated) return;
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        _queue = parsed.filter((item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.patientId === "string" &&
          typeof item.latitude === "number" &&
          typeof item.longitude === "number",
        );
      }
    }
  } catch {
    _queue = [];
  } finally {
    _hydrated = true;
  }
}

async function persistQueue(): Promise<void> {
  try {
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(_queue));
  } catch {
    // best-effort persistence
  }
}

/** Read all queued emergencies. */
export async function getQueue(): Promise<QueuedEmergency[]> {
  await hydrateQueue();
  return [..._queue];
}

/** Add an emergency to the offline queue. */
export async function enqueue(
  item: Omit<QueuedEmergency, "id" | "queuedAt">,
): Promise<void> {
  await hydrateQueue();
  const entry: QueuedEmergency = {
    ...item,
    id: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: new Date().toISOString(),
  };
  _queue.push(entry);
  await persistQueue();
}

/** Remove an item from the queue by id. */
export async function dequeue(id: string): Promise<void> {
  await hydrateQueue();
  _queue = _queue.filter((item) => item.id !== id);
  await persistQueue();
}

/** Clear the entire queue. */
export async function clearQueue(): Promise<void> {
  _queue = [];
  _hydrated = true;
  try {
    await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
  } catch {
    // best-effort clear
  }
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
  const pending = await getQueue();
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
        await dequeue(item.id);
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
      await enqueue({ patientId, latitude: lat, longitude: lng, emergencyType, description });
      return { queued: true };
    }

    // Non-network error — propagate
    return { queued: false, error: result.error };
  } catch (_err: any) {
    // Probably a network error
    await enqueue({ patientId, latitude: lat, longitude: lng, emergencyType, description });
    return { queued: true };
  }
}

