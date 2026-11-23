import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clear, createStore } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../src/client/App';

const pwa = vi.hoisted(() => ({ needRefresh: false, update: vi.fn(async () => undefined) }));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [pwa.needRefresh, () => undefined],
    offlineReady: [false, () => undefined],
    updateServiceWorker: pwa.update,
  }),
}));

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const IOS_HINT = 'Tip: zet de app op je beginscherm via Delen → Zet op beginscherm.';
const HINT_KEY = 'inspectie.iosHintSeen';

beforeEach(async () => {
  await clear(createStore('werkplekinspectie', 'kv'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ hasLogo: false }) })),
  );
  history.replaceState(null, '', '/');
  localStorage.clear();
  pwa.needRefresh = false;
  pwa.update.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as { standalone?: boolean }).standalone;
});

function useAgent(ua: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
}

function standaloneDisplay(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: matches && query === '(display-mode: standalone)' }));
}

async function startScreen() {
  render(<App />);
  await screen.findByRole('button', { name: 'Start inspectie' });
}

describe('update banner', () => {
  test('shows on the start screen when a new version waits; Vernieuwen activates it', async () => {
    pwa.needRefresh = true;
    const user = userEvent.setup();
    await startScreen();
    expect(screen.getByText('Er is een nieuwe versie.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Vernieuwen' }));
    expect(pwa.update).toHaveBeenCalledWith(true);
  });

  test('is not shown without a new version', async () => {
    await startScreen();
    expect(screen.queryByText('Er is een nieuwe versie.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vernieuwen' })).toBeNull();
  });

  test('is never shown during an inspection', async () => {
    pwa.needRefresh = true;
    const user = userEvent.setup();
    await startScreen();
    await user.type(screen.getByLabelText('Jouw naam'), 'J. Jansen');
    await user.type(screen.getByLabelText('Project'), 'Voorbeeld B.V.');
    await user.type(screen.getByLabelText('Projectnummer'), 'P-1');
    await user.click(screen.getByRole('button', { name: 'Start inspectie' }));
    await screen.findByRole('radio', { name: 'Ja' });
    expect(screen.queryByText('Er is een nieuwe versie.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vernieuwen' })).toBeNull();
  });
});

describe('iOS home screen hint', () => {
  test('shows in iOS Safari until Oké is tapped, and stays away after that', async () => {
    useAgent(IPHONE_SAFARI);
    standaloneDisplay(false);
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    expect(await screen.findByText(IOS_HINT)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Oké' }));
    expect(screen.queryByText(IOS_HINT)).toBeNull();
    expect(localStorage.getItem(HINT_KEY)).not.toBeNull();
    unmount();

    await startScreen();
    expect(screen.queryByText(IOS_HINT)).toBeNull();
  });

  test.each([
    ['Android Chrome', ANDROID_CHROME],
    ['Chrome on iPhone', IPHONE_CHROME],
  ])('is not shown in %s', async (_name, ua) => {
    useAgent(ua);
    standaloneDisplay(false);
    await startScreen();
    expect(screen.queryByText(IOS_HINT)).toBeNull();
  });

  test('is not shown when the app already runs from the home screen (navigator.standalone)', async () => {
    useAgent(IPHONE_SAFARI);
    (navigator as { standalone?: boolean }).standalone = true;
    await startScreen();
    expect(screen.queryByText(IOS_HINT)).toBeNull();
  });

  test('is not shown in display-mode standalone', async () => {
    useAgent(IPHONE_SAFARI);
    standaloneDisplay(true);
    await startScreen();
    expect(screen.queryByText(IOS_HINT)).toBeNull();
  });

  test('still works when localStorage is blocked', async () => {
    useAgent(IPHONE_SAFARI);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText(IOS_HINT)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Oké' }));
    expect(screen.queryByText(IOS_HINT)).toBeNull();
  });
});
