import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

/**
 * Scroll motion for the public marketing pages: smooth scrolling, sections
 * that rise into place as they reach the viewport, and a little parallax on
 * the hero product shot.
 *
 * This module is the whole of GSAP and Lenis in the product. It is only ever
 * reached through the dynamic `import()` in `useMarketingMotion`, after first
 * paint and only for a visitor who has not asked for reduced motion, so
 * nothing here can decide whether the page is readable. The rules that keep
 * it that way are in docs/DESIGN-SYSTEM.md §4:
 *
 * - **Nothing is hidden until it would have been unseen anyway.** An element
 *   is only set to its "from" state if it is still below the viewport when
 *   this runs. Whatever the visitor can already see is left alone, so a slow
 *   download cannot make visible copy blink out and back.
 * - **Every reveal runs once** and finishes at the element's own resting
 *   style, so `revert()` on unmount leaves the DOM exactly as React drew it.
 * - **Hero copy is not animated here.** It enters with the CSS `fade-up`
 *   keyframe, which paints with no JavaScript at all; see `HomePage`.
 *
 * Markup opts in with data attributes, so the section components carry no
 * GSAP imports and render identically when this never loads:
 *
 * - `data-reveal` on each item that should rise in, batched per scroll.
 * - `data-parallax="phone"` / `"frame"` inside `ProductPreview`.
 * - `data-scroll-nav` on the sticky header, which gets `data-scrolled` once
 *   the page has moved.
 */

gsap.registerPlugin(ScrollTrigger);

/** The marketing reveal: 500ms, 60ms between items, 16px of travel. */
const REVEAL = { duration: 0.5, stagger: 0.06, distance: 16, ease: 'power2.out' };

export function startMarketingMotion(root: HTMLElement): () => void {
  const lenis = new Lenis({ autoRaf: false });
  const tick = (time: number): void => lenis.raf(time * 1000);
  lenis.on('scroll', () => ScrollTrigger.update());
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);

  // A dialog locks the page by setting `overflow: hidden` on <body> (`Modal`,
  // the mobile menu). Lenis scrolls the window programmatically, which that
  // does not stop, so the page would keep gliding behind an open dialog.
  // Watching the one attribute every lock already writes keeps this module
  // the only thing that knows Lenis exists.
  const syncLock = (): void => {
    if (document.body.style.overflow === 'hidden') lenis.stop();
    else lenis.start();
  };
  const lockObserver = new MutationObserver(syncLock);
  lockObserver.observe(document.body, { attributes: true, attributeFilter: ['style'] });
  syncLock();

  const ctx = gsap.context(() => {
    const viewport = window.innerHeight;
    const unseen = gsap.utils
      .toArray<HTMLElement>('[data-reveal]', root)
      .filter((el) => el.getBoundingClientRect().top > viewport);

    gsap.set(unseen, { opacity: 0, y: REVEAL.distance });
    ScrollTrigger.batch(unseen, {
      start: 'top 92%',
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, {
          opacity: 1,
          y: 0,
          duration: REVEAL.duration,
          stagger: REVEAL.stagger,
          ease: REVEAL.ease,
          overwrite: true,
          clearProps: 'opacity,transform',
        }),
    });

    // Parallax is scrubbed against scroll position, so it never changes what
    // is visible, only where: the phone drifts up over the dashboard as the
    // hero leaves, which reads as depth rather than as an entrance.
    const phone = root.querySelector<HTMLElement>('[data-parallax="phone"]');
    const frame = root.querySelector<HTMLElement>('[data-parallax="frame"]');
    if (phone && frame) {
      const scrub = { trigger: frame, start: 'top 80%', end: 'bottom top', scrub: 0.6 };
      gsap.to(phone, { y: -48, ease: 'none', scrollTrigger: scrub });
      gsap.to(frame, { y: 16, ease: 'none', scrollTrigger: { ...scrub } });
    }

    const nav = root.querySelector<HTMLElement>('[data-scroll-nav]');
    if (nav) {
      ScrollTrigger.create({
        start: 8,
        end: 'max',
        onToggle: ({ isActive }) => nav.toggleAttribute('data-scrolled', isActive),
      });
    }
  }, root);

  // The consent banner pads <body> by its own height and clears it once
  // answered, and the webfonts swap in after first paint. Both move every
  // section, and ScrollTrigger only re-measures on a window resize.
  let pending = 0;
  const refresh = (): void => {
    window.cancelAnimationFrame(pending);
    pending = window.requestAnimationFrame(() => ScrollTrigger.refresh());
  };
  const sizeObserver = new ResizeObserver(refresh);
  sizeObserver.observe(document.documentElement);
  void document.fonts?.ready.then(refresh);

  return () => {
    window.cancelAnimationFrame(pending);
    sizeObserver.disconnect();
    lockObserver.disconnect();
    ctx.revert();
    gsap.ticker.remove(tick);
    lenis.destroy();
  };
}
