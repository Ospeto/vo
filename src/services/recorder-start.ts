/** Starts a recorder and guarantees asynchronous cleanup before propagating failure. */
export async function createAndStartRecorder<T>(create: () => T, start: (recorder: T) => void, cleanup: () => Promise<void>): Promise<T> {
  try {
    const recorder = create();
    start(recorder);
    return recorder;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
