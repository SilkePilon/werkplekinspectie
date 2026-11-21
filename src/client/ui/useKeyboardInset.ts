import { useEffect } from 'react';

/**
 * Keeps two CSS variables on <html> in step with the on-screen keyboard:
 *
 * - `--keyboard-inset`: how much of the bottom of the layout viewport the keyboard covers.
 *   Bottom sheets and footers add it to their `bottom`, so they ride on top of the keyboard.
 * - `--visual-height`: the height that is really visible, for a sheet's max-height.
 *
 * Android Chrome/Firefox shrink the layout viewport themselves (`interactive-widget=
 * resizes-content` in index.html), so the inset stays 0 there. iOS Safari never does: the
 * keyboard only shrinks the visual viewport, which this measures. Pinch zoom is not a keyboard,
 * so the inset is 0 while zoomed.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    const measure = () => {
      const zoomed = Math.abs(vv.scale - 1) > 0.01;
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      const inset = zoomed || covered < 1 ? 0 : Math.round(covered);
      root.style.setProperty('--keyboard-inset', `${inset}px`);
      root.style.setProperty('--visual-height', `${Math.round(vv.height)}px`);
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--keyboard-inset');
      root.style.removeProperty('--visual-height');
    };
  }, []);
}
