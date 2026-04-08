/**
 * Tests for utils/offline-queue.ts — offline emergency queue.
 */
import {
  getQueue,
  enqueue,
  dequeue,
  clearQueue,
  flushQueue,
  createOrQueueEmergency,
} from "../utils/offline-queue";

describe("Offline emergency queue", () => {
  beforeEach(async () => {
    await clearQueue();
  });

  test("starts empty", async () => {
    await expect(getQueue()).resolves.toEqual([]);
  });

  test("enqueue adds an item", async () => {
    await enqueue({
      patientId: "patient-1",
      latitude: 9.02,
      longitude: 38.75,
      emergencyType: "accident",
    });
    const queue = await getQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].patientId).toBe("patient-1");
    expect(queue[0].latitude).toBe(9.02);
    expect(queue[0].id).toMatch(/^offline_/);
    expect(queue[0].queuedAt).toBeTruthy();
  });

  test("enqueue adds multiple items", async () => {
    await enqueue({ patientId: "p1", latitude: 9.0, longitude: 38.7 });
    await enqueue({ patientId: "p2", latitude: 8.5, longitude: 39.2 });
    await expect(getQueue()).resolves.toHaveLength(2);
  });

  test("dequeue removes the correct item", async () => {
    await enqueue({ patientId: "p1", latitude: 9.0, longitude: 38.7 });
    await enqueue({ patientId: "p2", latitude: 8.5, longitude: 39.2 });

    const queue = await getQueue();
    await dequeue(queue[0].id);

    const remaining = await getQueue();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].patientId).toBe("p2");
  });

  test("clearQueue empties everything", async () => {
    await enqueue({ patientId: "p1", latitude: 9.0, longitude: 38.7 });
    await enqueue({ patientId: "p2", latitude: 8.5, longitude: 39.2 });
    await clearQueue();
    await expect(getQueue()).resolves.toEqual([]);
  });

  test("flushQueue calls createEmergency for each item", async () => {
    await enqueue({ patientId: "p1", latitude: 9.0, longitude: 38.7 });
    await enqueue({ patientId: "p2", latitude: 8.5, longitude: 39.2 });

    const mockCreate = jest.fn().mockResolvedValue({
      emergency: { id: "e1" },
      error: null,
    });

    const flushed = await flushQueue(mockCreate);
    expect(flushed).toBe(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    await expect(getQueue()).resolves.toEqual([]);
  });

  test("flushQueue stops on first failure", async () => {
    await enqueue({ patientId: "p1", latitude: 9.0, longitude: 38.7 });
    await enqueue({ patientId: "p2", latitude: 8.5, longitude: 39.2 });

    const mockCreate = jest.fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ emergency: { id: "e2" }, error: null });

    const flushed = await flushQueue(mockCreate);
    expect(flushed).toBe(0); // stopped after first failure
    await expect(getQueue()).resolves.toHaveLength(2); // both still in queue
  });

  test("createOrQueueEmergency returns emergency on success", async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      emergency: { id: "e1", status: "assigned" },
      error: null,
    });

    const result = await createOrQueueEmergency(
      mockCreate, "p1", 9.02, 38.75, "accident",
    );

    expect(result.queued).toBe(false);
    expect(result.emergency).toBeTruthy();
    expect(result.emergency.id).toBe("e1");
  });

  test("createOrQueueEmergency queues on network error", async () => {
    const mockCreate = jest.fn().mockRejectedValue(
      new Error("Network request failed"),
    );

    const result = await createOrQueueEmergency(
      mockCreate, "p1", 9.02, 38.75, "accident",
    );

    expect(result.queued).toBe(true);
    await expect(getQueue()).resolves.toHaveLength(1);
  });

  test("createOrQueueEmergency queues when error message indicates network issue", async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      emergency: null,
      error: new Error("All backend URLs unreachable"),
    });

    const result = await createOrQueueEmergency(
      mockCreate, "p1", 9.02, 38.75,
    );

    expect(result.queued).toBe(true);
  });

  test("createOrQueueEmergency propagates non-network errors", async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      emergency: null,
      error: new Error("Invalid patient ID"),
    });

    const result = await createOrQueueEmergency(
      mockCreate, "p1", 9.02, 38.75,
    );

    expect(result.queued).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error!.message).toContain("Invalid patient ID");
  });
});
