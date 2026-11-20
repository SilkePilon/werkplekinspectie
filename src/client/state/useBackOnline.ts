import { useEffect, useState } from 'react';

/**
 * True after the phone gets internet again, until it loses it. Lives in App, so an `online`
 * event on any screen still shows the banner once the technician is back on the start screen.
 */
export function useBackOnline(): boolean {
  const [back, setBack] = useState(false);
  useEffect(() => {
    const on = () => setBack(true);
    const off = () => setBack(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return back;
}
