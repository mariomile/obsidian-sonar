import { MarkdownView, Platform, type Plugin } from 'obsidian';

/** Downward travel before the surface is spun up. Small enough that the panel
 *  is already fading by the time the pull registers as deliberate. */
const OPEN_AT_PX = 8;
/** Travel at which the entrance reaches full opacity. */
const FULL_AT_PX = 130;
/** Travel past which releasing completes rather than reverts. Below `FULL_AT`
 *  on purpose: a short flick should commit without having to drag all the way. */
const COMMIT_AT_PX = 65;

/** The surface being pulled into view. Its opacity is driven continuously from
 *  the drag; release either finishes it or takes it back off. */
export interface PullSession {
  setProgress(p: number): void;
  commit(): void;
  cancel(): void;
}

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
 * Mobile-only "pull to search": dragging down while the active note sits at
 * its top brings Sonar in, with the panel's opacity tracking the finger the
 * whole way. Release past `COMMIT_AT_PX` finishes it; release short of that
 * takes it back and closes.
 *
 * The tracking is the point. Measured off a Craft Quick Open screen recording
 * (luminance sampled per frame inside the panel), three opens in the same
 * clip took 1.52s, 0.40s and ~0.1s, and a fourth reverted halfway — durations
 * that vary with the drag and a reversible midpoint are only possible if the
 * transition is bound to the gesture rather than fired by it. Nothing
 * translates: a given result row holds the same y in every frame. So the
 * feedback here is the surface itself materialising under the finger, never a
 * separate indicator and never movement.
 *
 * Listens on `document` rather than per-leaf, so it needs no
 * active-leaf-change bookkeeping — each touch re-resolves the current view
 * fresh, and `plugin.registerDomEvent` handles cleanup.
 */
export function registerPullToSearch(
  plugin: Plugin,
  isEnabled: () => boolean,
  begin: () => PullSession | null,
): void {
  if (!Platform.isMobile) return;

  let startY = 0;
  let dy = 0;
  let armed = false;
  let session: PullSession | null = null;

  const activeScroller = (): HTMLElement | null => {
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    return view ? getScroller(view) : null;
  };

  /** Drop the session without committing — used when the pull turns into a
   *  scroll, or the finger goes back up past the start. */
  const abort = (): void => {
    armed = false;
    session?.cancel();
    session = null;
    dy = 0;
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
      armed = !!scroller && scroller.scrollTop <= 0;
      startY = touch.clientY;
      dy = 0;
    },
    { passive: true },
  );

  plugin.registerDomEvent(
    document,
    'touchmove',
    (e: TouchEvent) => {
      if (!armed) return;
      const touch = e.touches[0];
      if (!touch) return;
      // Once the surface is up it covers the note, so re-reading the scroller
      // would be meaningless — only check while nothing has been opened yet.
      if (!session) {
        const scroller = activeScroller();
        if (!scroller || scroller.scrollTop > 0) {
          armed = false; // the pull turned into a real scroll
          return;
        }
      }
      dy = touch.clientY - startY;
      if (dy <= 0) {
        if (session) abort();
        return; // no downward travel yet — let the page behave normally
      }
      e.preventDefault(); // hold the page still: no overscroll bounce while pulling
      if (!session && dy >= OPEN_AT_PX) session = begin();
      session?.setProgress(Math.min(dy / FULL_AT_PX, 1));
    },
    { passive: false },
  );

  const end = (): void => {
    if (!armed) return;
    armed = false;
    if (session) {
      if (dy > COMMIT_AT_PX) session.commit();
      else session.cancel();
      session = null;
    }
    dy = 0;
  };
  plugin.registerDomEvent(document, 'touchend', end);
  plugin.registerDomEvent(document, 'touchcancel', end);
}
