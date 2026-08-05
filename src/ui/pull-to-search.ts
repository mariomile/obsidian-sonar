import { MarkdownView, Platform, type Plugin } from 'obsidian';

/** px of downward travel past the note's own top before the pull commits. */
const TRIGGER_THRESHOLD_PX = 90;

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
 * pull-to-refresh affordance. Listens on `document` rather than per-leaf, so
 * it needs no active-leaf-change bookkeeping — each touch re-resolves the
 * current view fresh, and `plugin.registerDomEvent` handles cleanup.
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

  const activeScroller = (): HTMLElement | null => {
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    return view ? getScroller(view) : null;
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
        return;
      }
      dy = touch.clientY - startY;
      if (dy <= 0) return; // no downward travel yet — let the page behave normally
      e.preventDefault(); // block the native overscroll bounce while pulling
    },
    { passive: false },
  );

  const end = (): void => {
    if (!tracking) return;
    tracking = false;
    if (dy > TRIGGER_THRESHOLD_PX) onTrigger();
    dy = 0;
  };
  plugin.registerDomEvent(document, 'touchend', end);
  plugin.registerDomEvent(document, 'touchcancel', end);
}
