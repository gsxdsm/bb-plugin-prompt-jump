// bb-plugin-prompt-jump: a "previous prompt" button in each thread's chat,
// beside bb's scroll-to-latest button. Each click scrolls the chat so the previous user message sits at the
// top of the view. Shift-click jumps to the next user message instead.
//
// bb renders the timeline in windows, so user messages far above may not be in
// the DOM. When none is rendered above the view, the button pages the scroll
// area up until bb renders one or the chat reaches its top.
import { definePluginApp } from "@get-bb/plugin-sdk/app";

const BUTTON_ATTR = "data-prompt-jump-button";
const STYLE_ID = "prompt-jump-style";

// bb markup (bb-app thread-detail): every timeline row carries
// data-timeline-row-id; a user message's column holds a right-aligned
// (`ml-auto`) bubble, an assistant message's does not.
const TIMELINE = "[data-timeline-items]";
const ROW = "[data-timeline-row-id]";
const USER_BUBBLE = "[data-message-column] > .ml-auto";
const LATEST_BUTTON = 'button[aria-label="Scroll to latest event"]';

// Top margin of the arrows in bb's zero-height row at the top of the composer.
// In that row the arrow's center sits at half this offset: 21px above the
// composer, in the gap below the last message.
const ARROW_OFFSET = "-42px";

const TOP_MARGIN = 12; // px of space left above the message we land on
const EPSILON = 4; // px; a message closer than this to the top counts as "here"
const MAX_PAGE_STEPS = 400;

const STYLES = `
[${BUTTON_ATTR}] {
  position: absolute;
  left: 50%;
  bottom: 16px;
  translate: -50% 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9999px;
  border: 1px solid var(--border);
  background: var(--card, var(--background));
  color: var(--foreground);
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
  cursor: pointer;
  opacity: 0.85;
  transition: opacity 120ms, transform 120ms;
}
[${BUTTON_ATTR}]:hover { opacity: 1; transform: translateY(-1px); }
[${BUTTON_ATTR}][data-hidden] { display: none; }
[${BUTTON_ATTR}][data-inline] {
  position: relative;
  left: auto;
  bottom: auto;
  translate: none;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  margin: ${ARROW_OFFSET} 8px 0 0;
  background: var(--background);
  box-shadow: none;
  opacity: 1;
  transition: background-color 200ms;
}
[${BUTTON_ATTR}][data-inline]:hover { background: var(--accent); transform: none; }
[${BUTTON_ATTR}][data-inline][data-hidden] { display: none; }
[${BUTTON_ATTR}][data-inline]:has(~ ${LATEST_BUTTON}.invisible) { margin-right: 0; }
[${BUTTON_ATTR}][data-inline] ~ ${LATEST_BUTTON}.invisible { display: none !important; }
[${BUTTON_ATTR}][data-inline] svg { width: 14px; height: 14px; }
/* bb's own arrow: same smaller size and lower position, so the two arrows sit
   in the gap above the composer instead of over the last message. */
${LATEST_BUTTON} {
  width: 24px !important;
  height: 24px !important;
  margin-top: ${ARROW_OFFSET} !important;
}
${LATEST_BUTTON} svg { width: 14px; height: 14px; }
[${BUTTON_ATTR}][data-busy] { opacity: 0.5; cursor: progress; }
[${BUTTON_ATTR}] svg { width: 16px; height: 16px; }
`;

// lucide "arrow-up"
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>`;

/** The nearest ancestor that scrolls vertically: bb's chat scroll viewport. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let e = element.parentElement; e; e = e.parentElement) {
    const overflow = getComputedStyle(e).overflowY;
    if (overflow === "auto" || overflow === "scroll") return e;
  }
  return null;
}

/**
 * Scroll as if the user did. bb keeps the chat pinned to the latest message
 * and undoes scrolls it can't attribute to the user; it attributes a scroll to
 * the user for 150ms after a wheel event on the scroller. A synthetic wheel
 * event does not scroll anything itself.
 */
function scrollAreaTo(area: HTMLElement, top: number): void {
  area.dispatchEvent(
    new WheelEvent("wheel", { deltaY: top < area.scrollTop ? -1 : 1, bubbles: true }),
  );
  area.scrollTop = top;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

/** Rendered user-message rows inside a scroll area, in document order. */
function userRows(area: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const bubble of area.querySelectorAll<HTMLElement>(USER_BUBBLE)) {
    const row = bubble.closest<HTMLElement>(ROW);
    // Skip rows inside nested scrollers (e.g. a collapsed subagent bundle).
    if (row && !rows.includes(row) && scrollerOf(row) === area) {
      rows.push(row);
    }
  }
  return rows;
}

/** Offset of a row's top from the scroll area's visible top, in px. */
function offsetFromTop(area: HTMLElement, row: HTMLElement): number {
  return row.getBoundingClientRect().top - area.getBoundingClientRect().top;
}

function findTarget(
  area: HTMLElement,
  direction: "up" | "down",
): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestOffset = 0;
  for (const row of userRows(area)) {
    const offset = offsetFromTop(area, row) - TOP_MARGIN;
    if (direction === "up" ? offset < -EPSILON : offset > EPSILON) {
      if (
        best === null ||
        (direction === "up" ? offset > bestOffset : offset < bestOffset)
      ) {
        best = row;
        bestOffset = offset;
      }
    }
  }
  return best;
}

async function alignRow(area: HTMLElement, row: HTMLElement): Promise<void> {
  const id = row.getAttribute("data-timeline-row-id");
  scrollAreaTo(area, area.scrollTop + offsetFromTop(area, row) - TOP_MARGIN);
  // Windowing can re-measure rows after a scroll; correct once it settles.
  for (let i = 0; i < 3; i += 1) {
    await nextFrame();
    const current =
      id === null
        ? row
        : area.querySelector<HTMLElement>(
            `${ROW}[data-timeline-row-id="${CSS.escape(id)}"]`,
          );
    if (!current) return;
    const drift = offsetFromTop(area, current) - TOP_MARGIN;
    if (Math.abs(drift) <= 1) return;
    scrollAreaTo(area, area.scrollTop + drift);
  }
}

async function jump(
  area: HTMLElement,
  direction: "up" | "down",
  signal: AbortSignal,
): Promise<void> {
  for (let step = 0; step < MAX_PAGE_STEPS && !signal.aborted; step += 1) {
    const target = findTarget(area, direction);
    if (target) {
      await alignRow(area, target);
      return;
    }
    const before = area.scrollTop;
    const page = Math.max(100, area.clientHeight * 0.8);
    if (direction === "up") {
      if (before <= 0) return;
      scrollAreaTo(area, Math.max(0, before - page));
    } else {
      const max = area.scrollHeight - area.clientHeight;
      if (before >= max - 1) return;
      scrollAreaTo(area, Math.min(max, before + page));
    }
    await nextFrame();
    if (area.scrollTop === before) return; // could not move; give up
  }
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "prompt-jump",
    mount({ signal }) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = STYLES;
      document.head.append(style);

      const buttons = new Map<HTMLElement, HTMLButtonElement>();
      const busy = new WeakSet<HTMLElement>();

      const updateVisibility = (area: HTMLElement) => {
        const button = buttons.get(area);
        if (!button) return;
        button.toggleAttribute("data-hidden", area.scrollTop <= 0);
      };

      const attach = (area: HTMLElement) => {
        if (buttons.has(area)) return;
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute(BUTTON_ATTR, "");
        button.title = "Previous prompt (Shift-click: next prompt)";
        button.setAttribute("aria-label", "Scroll to previous prompt");
        button.innerHTML = ICON;
        button.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            if (busy.has(area)) return;
            busy.add(area);
            button.setAttribute("data-busy", "");
            jump(area, event.shiftKey ? "down" : "up", signal)
              .catch((error: unknown) =>
                console.error("[prompt-jump] jump failed", error),
              )
              .finally(() => {
                busy.delete(area);
                button.removeAttribute("data-busy");
                updateVisibility(area);
              });
          },
          { signal },
        );
        area.addEventListener("scroll", () => updateVisibility(area), {
          passive: true,
          signal,
        });

        buttons.set(area, button);
        place(area, button);
        updateVisibility(area);
      };

      const place = (area: HTMLElement, button: HTMLButtonElement) => {
        const latest = Array.from(
          area.querySelectorAll<HTMLElement>(LATEST_BUTTON),
        ).find((candidate) => scrollerOf(candidate) === area);
        if (latest) {
          if (button.nextElementSibling !== latest) latest.before(button);
          if (!button.hasAttribute("data-inline")) {
            button.setAttribute("data-inline", "");
          }
          return;
        }
        const corner = area.parentElement;
        if (corner && button.parentElement !== corner) corner.append(button);
        if (button.hasAttribute("data-inline")) {
          button.removeAttribute("data-inline");
        }
      };

      const scan = () => {
        for (const timeline of document.querySelectorAll<HTMLElement>(
          TIMELINE,
        )) {
          if (timeline.parentElement?.closest(TIMELINE)) continue; // nested
          const area = scrollerOf(timeline);
          if (area) attach(area);
        }
        for (const [area, button] of buttons) {
          if (!area.isConnected) {
            button.remove();
            buttons.delete(area);
          } else {
            place(area, button);
          }
        }
      };

      let scheduled = 0;
      const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = requestAnimationFrame(() => {
          scheduled = 0;
          scan();
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
      scan();

      return () => {
        observer.disconnect();
        if (scheduled) cancelAnimationFrame(scheduled);
        for (const button of buttons.values()) button.remove();
        buttons.clear();
        style.remove();
      };
    },
  });
});
