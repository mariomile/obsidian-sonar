/**
 * Yield to the event loop via MessageChannel.
 *
 * `setTimeout(0)` is throttled to ~1s when the window is backgrounded/unfocused
 * (Chromium timer throttling), which stalls a long index build the moment the
 * user switches away. A MessageChannel message is dispatched as a macrotask
 * that is NOT subject to that throttling, so the build keeps progressing.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}
