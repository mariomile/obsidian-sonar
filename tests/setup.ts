// Plugin code uses `window.setTimeout` / `window.clearTimeout` (popout-window
// safe, per Obsidian's review guidelines). Vitest runs in a plain Node
// environment, so alias `window` to the global object; fake timers installed
// with `vi.useFakeTimers()` then apply to both.
(globalThis as unknown as { window: typeof globalThis }).window ??= globalThis;
