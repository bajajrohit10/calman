"use client";

/** The blink cycle, in milliseconds. Must match --animate-blink in globals.css. */
export const BLINK_MS = 2400;

/**
 * Put an element's blink on the same beat as every other blinking element.
 *
 * Two CSS animations start when their elements start, and the New Calls pill
 * and the sidebar badge do not arrive together — the badge streams in behind
 * a Suspense boundary, the pill hydrates with the page. Left alone they drift
 * apart and the two alerts flash against each other, which reads as two
 * separate things going wrong rather than one number worth looking at.
 *
 * So the animation is dragged onto the wall clock: its start time is set to
 * whatever moment would put it exactly `Date.now() % BLINK_MS` into the
 * cycle right now. Anything synced this way is in step with anything else
 * synced this way, whenever either of them mounted.
 *
 * It moves the animation's start rather than setting a negative
 * animation-delay, which is the obvious version and is wrong: a CSS
 * animation starts at the element's first paint, not when a ref runs, so a
 * delay measured at hydration time bakes in however long hydration took —
 * two elements hydrating together agree, and one arriving later does not.
 * That is precisely the case this exists for, because the badge streams in
 * behind its own Suspense boundary.
 *
 * Used as a ref callback, one frame late: at ref time the element is in the
 * tree but its animation has not been created yet, so getAnimations() is
 * empty. Refs run on the client only, so nothing here can disagree with the
 * server's HTML.
 */
export function syncBlink(el: HTMLElement | null) {
  if (!el) return;
  requestAnimationFrame(() => {
    const origin = Number(document.timeline.currentTime ?? 0) - (Date.now() % BLINK_MS);
    for (const animation of el.getAnimations()) {
      if ((animation as CSSAnimation).animationName?.startsWith("calman-blink")) {
        animation.startTime = origin;
      }
    }
  });
}
