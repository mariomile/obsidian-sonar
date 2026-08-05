import { MarkdownView, Platform, setIcon, type Plugin } from 'obsidian';

/** px of downward travel past the note's own top before the pull commits. */
const TRIGGER_THRESHOLD_PX = 90;
/** Indicator reaches full opacity/scale at this fraction of the threshold, so
 *  it's clearly "armed" a little before release actually commits. */
const ARMED_AT = 0.75;
/** Spring-back when the pull is abandoned. */
const CANCEL_EASE =
  'transform 220ms cubic-bezier(0.32, 0.72, 0, 1), opacity 180ms ease, background-color 140ms ease, color 140ms ease';
/** Hand-off when the pull commits: the card drops into the very spot the
 *  indicator occupies, so it clears fast and expands rather than travelling
 *  further down into a collision. */
const COMMIT_EASE = 'transform 160ms ease-out, opacity 120ms ease-out';

/** The scrollable element for `view`'s current mode — reading and edit mode
 *  each own a different scroll container. */
function getScroller(view: MarkdownView): HTMLElement | null {
  if (view.getMode() === 'preview') {
    return view.contentEl.querySelector<HTMLElement>(
      '.markdown-reading-view .markdown-preview-view',
    );
  }
  // @ts-expect-error - cm is exposed at runtime on the Obsidian Editor, not in the public typings
  const cm = view.editor?.cm;
  return (cm?.scrollDOM as HTMLElement | undefined) ?? null;
}

/**
 * Mobile-only "pull to search" gesture: dragging down while the active note's
 * scroll container is already pinned to its top opens Sonar, mirroring a
 * pull-to-refresh affordance. A floating indicator tracks the drag 1:1 (set
 * directly from touchmove, like `SonarModal`'s own dismiss-drag) so the
 * gesture reads as continuous rather than a silent threshold with a canned
 * pop at the end. `onTrigger`'s modal then drops in as a height-capped
 * floating card (`main.ts` passes `pullOpened: true`) landing right where the
 * indicator sat — a light gesture answered by a light surface, instead of the
 * full-height sheet the ribbon and command still open.
 *
 * Listens on `document` rather than per-leaf, so it needs no
 * active-leaf-change bookkeeping — each touch re-resolves the current view
 * fresh, and `plugin.registerDomEvent`/`plugin.register` handle cleanup.
 */
export function registerPullToSearch(
  plugin: Plugin,
  isEnabled: () => boolean,
  onTrigger: () => void,
): void {
  if (!Platform.isMobile) return;

  let startY = 0;
  let dy = 0;
  let tracking = false;
  let indicatorEl: HTMLElement | null = null;

  const activeScroller = (): HTMLElement | null => {
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    return view ? getScroller(view) : null;
  };

  const ensureIndicator = (): HTMLElement => {
    if (indicatorEl) return indicatorEl;
    const el = document.body.createDiv({ cls: 'sonar-pull-indicator' });
    setIcon(el.createSpan({ cls: 'sonar-pull-indicator__glyph' }), 'search');
    indicatorEl = el;
    return el;
  };

  /** Live-drive the indicator from the current drag distance — no transition,
   *  same as the dismiss-drag's `move` handler, so it never lags the finger. */
  const track = (progress: number): void => {
    const el = ensureIndicator();
    el.style.transition = 'none';
    const clamped = Math.min(progress, 1);
    el.style.opacity = String(Math.min(progress / 0.35, 1));
    el.style.transform = `translateX(-50%) translateY(${clamped * 36 - 8}px) scale(${0.5 + clamped * 0.5})`;
    el.toggleClass('is-armed', progress >= ARMED_AT);
  };

  /** Snap the indicator to its resting state: handed off into the opening card
   *  (`committed`) or springing back because the pull was cancelled. */
  const settle = (committed: boolean): void => {
    const el = indicatorEl;
    if (!el) return;
    el.removeClass('is-armed');
    if (!committed) {
      el.style.transition = CANCEL_EASE;
      el.style.opacity = '0';
      el.style.transform = 'translateX(-50%) translateY(-8px) scale(0.5)';
      return;
    }
    el.style.transition = COMMIT_EASE;
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(4px) scale(1.5)';
  };

  plugin.registerDomEvent(
    document,
    'touchstart',
    (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch || e.touches.length !== 1 || !isEnabled()) return;
      const scroller = activeScroller();
      // Only eligible when the note is already pinned to its top — otherwise
      // this is an ordinary scroll, not a pull.
      tracking = !!scroller && scroller.scrollTop <= 0;
      startY = touch.clientY;
      dy = 0;
    },
    { passive: true },
  );

  plugin.registerDomEvent(
    document,
    'touchmove',
    (e: TouchEvent) => {
      if (!tracking) return;
      const touch = e.touches[0];
      if (!touch) return;
      const scroller = activeScroller();
      if (!scroller || scroller.scrollTop > 0) {
        tracking = false; // the pull turned into a real scroll
        settle(false);
        return;
      }
      dy = touch.clientY - startY;
      if (dy <= 0) {
        if (indicatorEl) settle(false);
        return; // no downward travel yet — let the page behave normally
      }
      e.preventDefault(); // block the native overscroll bounce while pulling
      track(dy / TRIGGER_THRESHOLD_PX);
    },
    { passive: false },
  );

  const end = (): void => {
    if (!tracking) return;
    tracking = false;
    const committed = dy > TRIGGER_THRESHOLD_PX;
    settle(committed);
    if (committed) onTrigger();
    dy = 0;
  };
  plugin.registerDomEvent(document, 'touchend', end);
  plugin.registerDomEvent(document, 'touchcancel', end);
  plugin.register(() => indicatorEl?.remove());
}
