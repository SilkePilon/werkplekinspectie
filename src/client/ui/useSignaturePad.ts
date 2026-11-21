import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import SignaturePad from 'signature_pad';
import { LIMITS } from '@shared/limits';

// Ink colour, and widths that look like a pen when drawn with a finger.
const PEN = { penColor: '#26193c', minWidth: 1.5, maxWidth: 4 } as const;

const PNG_PREFIX = 'data:image/png;base64,';
// Same rule as the server schema: the base64 body may hold at most LIMITS.signatureBytes.
const MAX_BASE64 = Math.ceil((LIMITS.signatureBytes * 4) / 3);

const fits = (url: string) => url.startsWith(PNG_PREFIX) && url.length - PNG_PREFIX.length <= MAX_BASE64;

const pixelRatio = () => Math.max(window.devicePixelRatio || 1, 1);

/** Sizes the drawing buffer to the canvas's CSS size × ratio. Clears it; returns false if nothing changed. */
function fitCanvas(canvas: HTMLCanvasElement, ratio: number): boolean {
  const width = Math.round(canvas.offsetWidth * ratio);
  const height = Math.round(canvas.offsetHeight * ratio);
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  // Strokes are recorded in CSS pixels; draw them at the device's sharpness.
  canvas.getContext('2d')?.scale(ratio, ratio);
  return true;
}

export interface SignaturePadControls {
  isEmpty: boolean;
  clear: () => void;
  /** The signature as a PNG data URL within LIMITS.signatureBytes, or null when empty or too large. */
  exportPng: () => string | null;
}

/** signature_pad on the given canvas, kept sharp and intact when the canvas changes size. */
export function useSignaturePad(canvasRef: RefObject<HTMLCanvasElement | null>): SignaturePadControls {
  const padRef = useRef<SignaturePad | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pad = new SignaturePad(canvas, PEN);
    padRef.current = pad;
    const onEnd = () => setIsEmpty(pad.isEmpty());
    pad.addEventListener('endStroke', onEnd);

    // Resizing the buffer wipes it: draw the recorded strokes again.
    const resize = () => {
      const strokes = pad.toData();
      if (fitCanvas(canvas, pixelRatio())) pad.fromData(strokes);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      pad.removeEventListener('endStroke', onEnd);
      pad.off();
      padRef.current = null;
    };
  }, [canvasRef]);

  const clear = useCallback(() => {
    padRef.current?.clear();
    setIsEmpty(true);
  }, []);

  const exportPng = useCallback((): string | null => {
    const pad = padRef.current;
    const canvas = canvasRef.current;
    if (!pad || !canvas || pad.isEmpty()) return null;
    const sharp = pad.toDataURL('image/png');
    if (fits(sharp)) return sharp;

    // Too big at the device's ratio: draw once at ratio 1, export, and put it back.
    const ratio = pixelRatio();
    const strokes = pad.toData();
    fitCanvas(canvas, 1);
    pad.fromData(strokes);
    const small = pad.toDataURL('image/png');
    if (fitCanvas(canvas, ratio)) pad.fromData(strokes);
    return fits(small) ? small : null;
  }, [canvasRef]);

  return { isEmpty, clear, exportPng };
}
