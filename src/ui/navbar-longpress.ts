import { Platform, type Plugin } from 'obsidian';

/** Hold time before a press on the navbar icon counts as "long" rather than a
 *  tap headed for the Quick Switcher. Below Obsidian core's own long-press
 *  menus (~500ms) so Sonar never loses the race to them. */
const HOLD_MS = 450;
/** Finger travel that cancels the hold — this is a press, not a drag. */
const MOVE_TOLERANCE_PX = 12;
/** Safety net: force the suppression flag back off even if `touchend`/
 *  `touchcancel` never fire for this touch (a stuck flag would start
 *  swallowing every unrelated touchend on the page, including the one that
 *  closes Sonar's own sheet — the exact failure a first cut of this shipped
 *  with). Comfortably above HOLD_MS + a real release. */
const FIRED_RESET_MS = 1200;

const TARGET_SELECTOR = '.mobile-navbar-action-quick-switcher';

/**
 * Mobile-only: long-pressing the search (Quick Switcher) icon in Obsidian's
 * bottom navbar opens Sonar instead. A normal tap is left untouched — it
 * still opens core's Quick Switcher.
 *
 * The suppression that swallows the post-hold tap is scoped two ways so it
 * can never leak onto unrelated touches: it only intercepts a `touchend`
 * whose target is the *same element* the hold started on, and `fired` is
 * force-cleared on a timeout regardless of whether `touchend`/`touchcancel`
 * ever arrive. Losing either guard is what let a stuck flag start eating
 * every touchend on the page — including taps on Sonar's own close button —
 * which is why the very first version of this looked like "the sheet won't
 * close" rather than "the sheet won't close *sometimes*".
 *
 * Listens on `document` with a `closest()` check rather than binding to the
 * element directly: the navbar action is re-created by core on layout
 * changes, so a cached reference would go stale.
 */
export function registerNavbarLongPress(
  plugin: Plugin,
  isEnabled: () => boolean,
  onLongPress: () => void,
): void {
  if (!Platform.isMobile) return;

  let holdTimer: number | null = null;
  let resetTimer: number | null = null;
  let startX = 0;
  let startY = 0;
  let fired = false;
  let target: HTMLElement | null = null;

  const clearHoldTimer = (): void => {
    if (holdTimer !== null) {
      window.clearTimeout(holdTimer);
      holdTimer = null;
    }
  };
  const clearResetTimer = (): void => {
    if (resetTimer !== null) {
      window.clearTimeout(resetTimer);
      resetTimer = null;
    }
  };

  /** Drop everything back to idle — used on release, on cancel, on a move
   *  past tolerance, and by the safety-net timeout. */
  const reset = (): void => {
    clearHoldTimer();
    clearResetTimer();
    fired = false;
    target = null;
  };

  plugin.registerDomEvent(
    document,
    'touchstart',
    (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch || e.touches.length !== 1 || !isEnabled()) return;
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(TARGET_SELECTOR);
      if (!el) return;
      reset(); // a stray prior hold (e.g. an interrupted gesture) never carries over
      target = el;
      startX = touch.clientX;
      startY = touch.clientY;
      holdTimer = window.setTimeout(() => {
        holdTimer = null;
        fired = true;
        resetTimer = window.setTimeout(reset, FIRED_RESET_MS);
        // A light buzz is the only cue phones give for "this press did
        // something different" — core's own long-press menus use the same tell.
        navigator.vibrate?.(10);
        onLongPress();
      }, HOLD_MS);
    },
    { passive: true },
  );

  plugin.registerDomEvent(
    document,
    'touchmove',
    (e: TouchEvent) => {
      if (holdTimer === null || !target) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) reset();
    },
    { passive: true },
  );

  // Swallow the tap that would otherwise open the Quick Switcher once the
  // hold has already opened Sonar — scoped to the same element the hold
  // started on, so this can never intercept an unrelated touchend (e.g. one
  // that dismisses the Sonar sheet itself) even if `fired` somehow outlives
  // its normal window.
  plugin.registerDomEvent(
    document,
    'touchend',
    (e: TouchEvent) => {
      if (fired && target && (e.target as HTMLElement | null)?.closest(TARGET_SELECTOR) === target) {
        e.preventDefault();
        e.stopPropagation();
      }
      reset();
    },
    { capture: true },
  );
  plugin.registerDomEvent(document, 'touchcancel', reset);
}
