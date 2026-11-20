import { useState } from 'react';

const SEEN_KEY = 'inspectie.iosHintSeen';

/** Safari on iPhone or iPad (iPadOS reports itself as a Mac with touch); not Chrome, Firefox or Edge. */
function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function isStandalone(): boolean {
  if ((navigator as { standalone?: boolean }).standalone === true) return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
}

// Storage can be blocked (private mode, settings): then the hint just shows again next time.
function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Ignore: see above.
  }
}

/**
 * iOS has no install prompt, so Safari users get a tip to add the app to the home screen,
 * until they dismiss it once. Returns whether to show it and the dismiss action.
 */
export function useIosHint(): [show: boolean, dismiss: () => void] {
  const [show, setShow] = useState(() => isIosSafari() && !isStandalone() && !seen());
  const dismiss = () => {
    markSeen();
    setShow(false);
  };
  return [show, dismiss];
}
