import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clear, createStore } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { formatDate } from '@shared/dates';
import { QUESTION_IDS, type QuestionId } from '@shared/questions';
import type { Submission } from '@shared/schema';
import { App, type Screen } from '../../src/client/App';
import {
  newDraft,
  toSubmission,
  type AnswerValue,
  type Draft,
  type NeeDetails,
} from '../../src/client/state/draft';
import { addToOutbox, listOutbox, loadDraft, saveDraft } from '../../src/client/storage/db';

vi.mock('../../src/client/storage/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/client/storage/db')>();
  return { ...real, addToOutbox: vi.fn(real.addToOutbox) };
});

// jsdom has no canvas: a stand-in signature pad that is always "drawn".
const strokeEnded = vi.hoisted(() => new Set<() => void>());

vi.mock('signature_pad', () => ({
  default: class {
    isEmpty() {
      return false;
    }
    toData() {
      return [];
    }
    fromData() {}
    clear() {}
    toDataURL() {
      return SIGNATURE;
    }
    addEventListener(type: string, fn: () => void) {
      if (type === 'endStroke') strokeEnded.add(fn);
    }
    removeEventListener(type: string, fn: () => void) {
      if (type === 'endStroke') strokeEnded.delete(fn);
    }
    off() {}
  },
}));

const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const DECLARATION = 'Ik heb deze inspectie zelf gedaan en de antwoorden kloppen.';
const SAFE = 'Je inspectie staat veilig op deze telefoon. Er gaat niets verloren.';
const BACK_ONLINE = 'Je hebt weer internet. Je kunt je inspecties nu versturen.';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn<Fetch>>;
/** What POST /api/inspecties does next; the default is "no internet". */
let inspecties: (init?: RequestInit) => Promise<Response>;

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
const offline = async () => {
  throw new TypeError('Failed to fetch');
};

function posts(): Submission[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === '/api/inspecties')
    .map(([, init]) => JSON.parse(init?.body as string) as Submission);
}

beforeEach(async () => {
  // Only setTimeout is faked: fake-indexeddb schedules its work with setImmediate.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  await clear(createStore('werkplekinspectie', 'kv'));
  inspecties = offline;
  fetchMock = vi.fn<Fetch>(async (url, init) =>
    url === '/api/inspecties' ? inspecties(init) : new Response(JSON.stringify({ hasLogo: false })),
  );
  vi.stubGlobal('fetch', fetchMock);
  history.replaceState(null, '', '/');
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(addToOutbox).mockClear();
});

function setup() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

function button(name: string | RegExp, in_: HTMLElement = document.body): HTMLButtonElement {
  return within(in_).getByRole('button', { name }) as HTMLButtonElement;
}

const allJa = () =>
  Object.fromEntries(QUESTION_IDS.map((id) => [id, 'ja'])) as Partial<Record<QuestionId, AnswerValue>>;

const nee = (photos: string[]): NeeDetails => ({ comment: 'Kapot.', actionBefore: '2099-12-04', photos });

async function seed(
  answers: Partial<Record<QuestionId, AnswerValue>> = allJa(),
  neeDetails: Partial<Record<QuestionId, NeeDetails>> = {},
): Promise<Draft> {
  const d: Draft = {
    ...newDraft('J. Jansen', 'Voorbeeld B.V.', 'P-1', new Date('2026-11-20T08:12:00Z')),
    answers,
    nee: neeDetails,
  };
  await saveDraft(d);
  return d;
}

/** Renders the app and jumps to a screen, as the phone's back/forward buttons would. */
async function openAt(target: Screen) {
  render(<App />);
  await screen.findByText('Je bent nog bezig met een inspectie');
  const state = { screen: target };
  act(() => {
    history.pushState(state, '');
    dispatchEvent(new PopStateEvent('popstate', { state }));
  });
}

/** A finished stroke on the signature pad. */
function draw() {
  act(() => strokeEnded.forEach((fn) => fn()));
}

/** On the signature screen: sign and tick the declaration. */
async function readyToSend(user: ReturnType<typeof setup>) {
  await openAt({ name: 'signature' });
  draw();
  await user.click(screen.getByText(DECLARATION));
  return button('Verstuur inspectie');
}

async function hidePage() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  try {
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  } finally {
    Reflect.deleteProperty(document, 'visibilityState');
  }
}

/** The draft as it is on the phone once every save has had its chance. */
async function draftOnDisk(): Promise<Draft | null> {
  await act(() => vi.advanceTimersByTimeAsync(400));
  await hidePage();
  return loadDraft();
}

describe('sending', () => {
  test('no internet: "Nog niet verstuurd", kept in the outbox; later "Nu versturen" sends the same inspection', async () => {
    const user = setup();
    const d = await seed();
    const send = await readyToSend(user);
    await user.click(send);

    expect(await screen.findByRole('heading', { name: 'Nog niet verstuurd' })).toBeTruthy();
    expect(screen.getByText('Je hebt nu geen internet.')).toBeTruthy();
    expect(screen.getByText(SAFE)).toBeTruthy();
    expect(await listOutbox()).toHaveLength(1);
    expect(await draftOnDisk()).toBeNull();

    await user.click(button('Later versturen'));
    const list = await screen.findByRole('region', { name: 'Nog te versturen' });
    expect(within(list).getByText(`Voorbeeld B.V., ${formatDate(d.startedAt)}`)).toBeTruthy();
    expect(screen.queryByText('Je bent nog bezig met een inspectie')).toBeNull();

    inspecties = reply(200, { status: 'verzonden' });
    await user.click(button('Nu versturen', list));
    expect(await screen.findByRole('heading', { name: 'Verstuurd!' })).toBeTruthy();
    expect(await listOutbox()).toEqual([]);

    const [first, second] = posts();
    expect(posts()).toHaveLength(2);
    expect(first!.submissionId).toBe(d.id);
    expect(second).toEqual(first);

    await user.click(button('Klaar'));
    expect(await screen.findByRole('button', { name: 'Start inspectie' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Nog te versturen' })).toBeNull();
  });

  test('"Opnieuw proberen" sends the stored inspection again with the same submissionId', async () => {
    const user = setup();
    const d = await seed();
    await user.click(await readyToSend(user));
    await user.click(await screen.findByRole('button', { name: 'Opnieuw proberen' }));
    expect(await screen.findByRole('heading', { name: 'Nog niet verstuurd' })).toBeTruthy();

    inspecties = reply(200, { status: 'verzonden' });
    await user.click(button('Opnieuw proberen'));
    expect(await screen.findByRole('heading', { name: 'Verstuurd!' })).toBeTruthy();

    const sent = posts();
    expect(sent).toHaveLength(3);
    expect(sent.map((s) => s.submissionId)).toEqual([d.id, d.id, d.id]);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[2]).toEqual(sent[0]);
  });

  test('Verstuurd!: stats from the sent inspection; no draft and an empty outbox', async () => {
    const user = setup();
    inspecties = reply(200, { status: 'verzonden' });
    await seed({ ...allJa(), '4B': 'nee', '3A': 'nee' }, { '4B': nee([PHOTO, PHOTO]), '3A': nee([PHOTO]) });
    await user.click(await readyToSend(user));

    expect(await screen.findByRole('heading', { name: 'Verstuurd!' })).toBeTruthy();
    expect(screen.getByText('De inspectie is gemaild naar de VGM-functionaris.')).toBeTruthy();
    const stats = screen.getByRole('list', { name: 'Samenvatting' });
    expect(within(stats).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '21vragen',
      '2keer Nee',
      "3foto's",
    ]);
    expect(await listOutbox()).toEqual([]);
    expect(await draftOnDisk()).toBeNull();

    const [sent] = posts();
    expect(sent).toMatchObject({ signature: SIGNATURE, declaration: true });
    expect(sent!.signedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
  });

  test('Review Focus 2: two clicks on "Verstuur inspectie" make exactly one request, busy meanwhile', async () => {
    const user = setup();
    let answer: (r: Response) => void = () => undefined;
    inspecties = () => new Promise((resolve) => (answer = resolve));
    await seed();
    const send = await readyToSend(user);

    // Both clicks land before React re-renders: only the in-flight guard can stop the second.
    act(() => {
      send.click();
      send.click();
    });
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(button('Verstuur inspectie').getAttribute('aria-busy')).toBe('true');
    expect(button('Verstuur inspectie').disabled).toBe(true);
    fireEvent.click(button('Verstuur inspectie'));

    await act(async () => answer(new Response(JSON.stringify({ status: 'verzonden' }), { status: 200 })));
    expect(await screen.findByRole('heading', { name: 'Verstuurd!' })).toBeTruthy();
    expect(posts()).toHaveLength(1);
    expect(vi.mocked(addToOutbox)).toHaveBeenCalledTimes(1);
  });

  test('a change during sending (untick the declaration) is ignored and cannot bring the draft back', async () => {
    const user = setup();
    let answer: (r: Response) => void = () => undefined;
    inspecties = () => new Promise((resolve) => (answer = resolve));
    await seed();
    await user.click(await readyToSend(user));
    await waitFor(() => expect(posts()).toHaveLength(1));

    fireEvent.click(screen.getByRole('checkbox', { name: DECLARATION }));
    expect((screen.getByRole('checkbox', { name: DECLARATION }) as HTMLInputElement).checked).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(400));
    await act(async () => answer(new Response(JSON.stringify({ status: 'verzonden' }), { status: 200 })));
    expect(await screen.findByRole('heading', { name: 'Verstuurd!' })).toBeTruthy();
    expect(await draftOnDisk()).toBeNull();
  });

  test('the outbox is written before the draft is cleared, and before the request', async () => {
    const user = setup();
    const order: string[] = [];
    const real = await vi.importActual<typeof import('../../src/client/storage/db')>('../../src/client/storage/db');
    vi.mocked(addToOutbox).mockImplementationOnce(async (s) => {
      order.push(`outbox write: draft ${(await loadDraft()) ? 'yes' : 'no'}`);
      await real.addToOutbox(s);
    });
    inspecties = async () => {
      order.push(`post: outbox ${(await listOutbox()).length}, draft ${(await loadDraft()) ? 'yes' : 'no'}`);
      return new Response(JSON.stringify({ status: 'verzonden' }), { status: 200 });
    };
    await seed();
    await user.click(await readyToSend(user));
    expect(await screen.findByRole('heading', { name: 'Verstuurd!' })).toBeTruthy();
    expect(order).toEqual(['outbox write: draft yes', 'post: outbox 1, draft no']);
  });

  test('when the outbox cannot be written: no request, the draft stays, an alert, still on the signature screen', async () => {
    const user = setup();
    vi.mocked(addToOutbox).mockRejectedValueOnce(new DOMException('Quota exceeded', 'QuotaExceededError'));
    const d = await seed();
    await user.click(await readyToSend(user));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Opslaan op deze telefoon lukt niet.');
    expect(screen.getByRole('heading', { name: 'Zet je handtekening' })).toBeTruthy();
    expect(posts()).toEqual([]);
    expect(await listOutbox()).toEqual([]);
    const kept = await draftOnDisk();
    expect(kept?.id).toBe(d.id);
    expect(kept?.signature).toBe(SIGNATURE);

    // Trying again once storage works sends it.
    inspecties = reply(200, { status: 'verzonden' });
    await user.click(button('Verstuur inspectie'));
    expect(await screen.findByRole('heading', { name: 'Verstuurd!' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  test('an inspection over the 12 MB body limit is not queued or sent: back to the summary with a message', async () => {
    const user = setup();
    const big = `data:image/jpeg;base64,${'A'.repeat(1_400_000)}`;
    const d = await seed(
      { ...allJa(), '1A': 'nee', '2A': 'nee', '3A': 'nee' },
      { '1A': nee([big, big, big]), '2A': nee([big, big, big]), '3A': nee([big, big, big]) },
    );
    await user.click(await readyToSend(user));

    expect(await screen.findByRole('heading', { name: 'Klopt alles?' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(
      "De inspectie is te groot om te versturen. Verwijder een paar foto's.",
    );
    expect(posts()).toEqual([]);
    expect(await listOutbox()).toEqual([]);
    expect((await draftOnDisk())?.id).toBe(d.id);
  });

  test('an incomplete draft is not sent: back to the summary', async () => {
    const user = setup();
    const answers = allJa();
    delete answers['9B'];
    await seed(answers);
    await user.click(await readyToSend(user));

    expect(await screen.findByRole('heading', { name: 'Klopt alles?' })).toBeTruthy();
    expect(posts()).toEqual([]);
    expect(await listOutbox()).toEqual([]);
    expect((await draftOnDisk())?.signature).toBe(SIGNATURE);
  });
});

describe('result screens', () => {
  test.each([
    [429, 'te_veel', 'Er zijn net te veel inspecties verstuurd. Probeer het later opnieuw.'],
    [502, 'mail_mislukt', 'Versturen is niet gelukt. Probeer het later opnieuw.'],
    [500, 'onbekend', 'Versturen is niet gelukt. Probeer het later opnieuw.'],
    [403, 'verboden', 'Versturen is niet gelukt. Probeer het later opnieuw.'],
  ])('%i %s: calm message, reassurance, retry or later; kept in the outbox', async (status, body, text) => {
    const user = setup();
    inspecties = reply(status, { status: body });
    await seed();
    await user.click(await readyToSend(user));

    expect(await screen.findByRole('heading', { name: 'Nog niet verstuurd' })).toBeTruthy();
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByText(SAFE)).toBeTruthy();
    expect(button('Opnieuw proberen')).toBeTruthy();
    expect(button('Later versturen')).toBeTruthy();
    expect(await listOutbox()).toHaveLength(1);
  });

  test('no answer in time: "Versturen duurde te lang", reassurance, retry or later; kept in the outbox', async () => {
    const user = setup();
    inspecties = (init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
      );
    await seed();
    await user.click(await readyToSend(user));
    await waitFor(() => expect(posts()).toHaveLength(1));
    await act(() => vi.advanceTimersByTimeAsync(181_000));

    expect(await screen.findByRole('heading', { name: 'Nog niet verstuurd' })).toBeTruthy();
    expect(screen.getByText('Versturen duurde te lang.')).toBeTruthy();
    expect(screen.queryByText('Je hebt nu geen internet.')).toBeNull();
    expect(screen.getByText(SAFE)).toBeTruthy();
    expect(button('Opnieuw proberen')).toBeTruthy();
    expect(button('Later versturen')).toBeTruthy();
    expect(await listOutbox()).toHaveLength(1);
  });

  test('413 te_groot: says to remove photos; "Aanpassen" brings it back into the draft', async () => {
    const user = setup();
    inspecties = reply(413, { status: 'te_groot' });
    const d = await seed({ ...allJa(), '4B': 'nee' }, { '4B': nee([PHOTO]) });
    await user.click(await readyToSend(user));

    expect(await screen.findByRole('heading', { name: 'Nog niet verstuurd' })).toBeTruthy();
    expect(screen.getByText('De inspectie is te groot om te versturen.')).toBeTruthy();
    expect(screen.getByText("Verwijder een paar foto's en probeer het opnieuw.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Opnieuw proberen' })).toBeNull();
    await user.click(button('Aanpassen'));

    expect(await screen.findByRole('heading', { name: 'Klopt alles?' })).toBeTruthy();
    expect(await listOutbox()).toEqual([]);
    expect(await draftOnDisk()).toMatchObject({ id: d.id, declaration: false });
  });

  test('400 ongeldig: "Aanpassen" takes it out of the outbox into the draft, highlights the item, asks to sign again', async () => {
    const user = setup();
    inspecties = reply(400, { status: 'ongeldig', fields: ['answers.4B.comment'] });
    const d = await seed({ ...allJa(), '4B': 'nee' }, { '4B': nee([PHOTO]) });
    await user.click(await readyToSend(user));

    expect(await screen.findByText('Er klopt iets niet in de inspectie.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Opnieuw proberen' })).toBeNull();
    await user.click(button('Aanpassen'));

    expect(await screen.findByRole('heading', { name: 'Klopt alles?' })).toBeTruthy();
    const card = screen.getByText(/^4B /).closest('li')!;
    expect(within(card).getByText('Kijk hier nog eens naar.')).toBeTruthy();
    expect(screen.getAllByText('Kijk hier nog eens naar.')).toHaveLength(1);
    expect(await listOutbox()).toEqual([]);
    const back = await draftOnDisk();
    expect(back).toMatchObject({ id: d.id, declaration: false, answers: { '4B': 'nee' } });
    expect(back?.signature).toBeUndefined();
    expect(back?.nee['4B']).toEqual(nee([PHOTO]));

    // Fixing and signing again sends with the same submissionId.
    inspecties = reply(200, { status: 'verzonden' });
    await user.click(button('Alles klopt, naar tekenen'));
    draw();
    await user.click(screen.getByText(DECLARATION));
    await user.click(button('Verstuur inspectie'));
    expect(await screen.findByRole('heading', { name: 'Verstuurd!' })).toBeTruthy();
    expect(posts().map((s) => s.submissionId)).toEqual([d.id, d.id]);
  });

  test('400 ongeldig on a field outside the questions: the summary opens without a highlight', async () => {
    const user = setup();
    inspecties = reply(400, { status: 'ongeldig', fields: ['signature'] });
    await seed();
    await user.click(await readyToSend(user));
    await user.click(await screen.findByRole('button', { name: 'Aanpassen' }));
    expect(await screen.findByRole('heading', { name: 'Klopt alles?' })).toBeTruthy();
    expect(screen.queryByText('Kijk hier nog eens naar.')).toBeNull();
  });

  test('400 from the outbox while another inspection is open: says so, and that draft is never overwritten', async () => {
    const user = setup();
    inspecties = reply(400, { status: 'ongeldig', fields: ['answers.1A'] });
    const open = await seed();
    const other = await outboxItem('Ander project');
    render(<App />);
    await user.click(button('Nu versturen', await screen.findByRole('region', { name: 'Nog te versturen' })));

    expect(await screen.findByText('Er klopt iets niet in de inspectie.')).toBeTruthy();
    expect(screen.getByText('Maak eerst je andere inspectie af of gooi hem weg.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aanpassen' })).toBeNull();
    await user.click(button('Later versturen'));

    expect(await screen.findByText('Je bent nog bezig met een inspectie')).toBeTruthy();
    expect((await draftOnDisk())?.id).toBe(open.id);
    expect((await listOutbox()).map((s) => s.submissionId)).toEqual([other.submissionId]);
  });

  test('an unexpected error while sending: the alert, the draft kept, no unhandled rejection', async () => {
    const user = setup();
    // Broken data from storage: toSubmission throws a TypeError, not IncompleteDraftError.
    const d = await seed(
      { ...allJa(), '4B': 'nee' },
      { '4B': { comment: 'Kapot.', actionBefore: '2099-12-04', photos: null as unknown as string[] } },
    );
    await user.click(await readyToSend(user));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Zet je handtekening' })).toBeTruthy();
    expect(button('Verstuur inspectie').getAttribute('aria-busy')).toBeNull();
    expect(posts()).toEqual([]);
    const kept = await draftOnDisk();
    expect(kept?.id).toBe(d.id);
    expect(kept?.signature).toBe(SIGNATURE);
  });
});

/** A signed inspection already waiting in the outbox. */
async function outboxItem(project: string): Promise<Submission> {
  const d: Draft = {
    ...newDraft('J. Jansen', project, 'P-2', new Date('2026-11-18T08:00:00Z')),
    answers: allJa(),
    signature: SIGNATURE,
    signedAt: '2026-11-18T10:00:00+01:00',
    declaration: true,
  };
  const s = toSubmission(d);
  await addToOutbox(s);
  return s;
}

describe('start screen outbox', () => {
  test('rows read "{project}, {datum}"; a draft and the outbox are both shown', async () => {
    const s = await outboxItem('Ander project');
    await seed();
    render(<App />);
    const list = await screen.findByRole('region', { name: 'Nog te versturen' });
    expect(within(list).getByText('Ander project, 18-11-2026')).toBeTruthy();
    expect(within(list).getByRole('button', { name: 'Nu versturen' })).toBeTruthy();
    expect(screen.getByText('Je bent nog bezig met een inspectie')).toBeTruthy();
    expect(s.startedAt).toMatch(/^2026-11-18/);
  });

  test('"Nu versturen" while sending: busy, and a second tap sends nothing', async () => {
    const user = setup();
    let answer: (r: Response) => void = () => undefined;
    inspecties = () => new Promise((resolve) => (answer = resolve));
    await outboxItem('Ander project');
    render(<App />);
    const list = await screen.findByRole('region', { name: 'Nog te versturen' });
    const now = button('Nu versturen', list);
    act(() => {
      now.click();
      now.click();
    });
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(button('Nu versturen', list).getAttribute('aria-busy')).toBe('true');
    await act(async () => answer(new Response(JSON.stringify({ status: 'verzonden' }), { status: 200 })));
    expect(await screen.findByRole('heading', { name: 'Verstuurd!' })).toBeTruthy();
    expect(posts()).toHaveLength(1);
    await user.click(button('Klaar'));
  });

  test('during "Nu versturen", Start inspectie waits; afterwards it works again', async () => {
    const user = setup();
    let answer: (r: Response) => void = () => undefined;
    inspecties = () => new Promise((resolve) => (answer = resolve));
    await outboxItem('Ander project');
    render(<App />);
    await user.type(await screen.findByLabelText('Naam'), 'J. Jansen');
    await user.type(screen.getByLabelText('Project'), 'Voorbeeld B.V.');
    await user.type(screen.getByLabelText('Projectnummer'), 'P-1');
    expect(button('Start inspectie').disabled).toBe(false);

    await user.click(button('Nu versturen'));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(button('Start inspectie').disabled).toBe(true);
    fireEvent.click(button('Start inspectie'));
    expect(screen.getByRole('button', { name: 'Start inspectie' })).toBeTruthy();

    await act(async () => answer(new Response(JSON.stringify({ status: 'verzonden' }), { status: 200 })));
    await user.click(await screen.findByRole('button', { name: 'Klaar' }));
    await user.type(await screen.findByLabelText('Naam'), 'J. Jansen');
    await user.type(screen.getByLabelText('Project'), 'Voorbeeld B.V.');
    await user.type(screen.getByLabelText('Projectnummer'), 'P-1');
    expect(button('Start inspectie').disabled).toBe(false);
  });

  test('during "Nu versturen", Verder gaan waits; afterwards no change to the draft is dropped', async () => {
    const user = setup();
    let answer: (r: Response) => void = () => undefined;
    inspecties = () => new Promise((resolve) => (answer = resolve));
    await seed({});
    await outboxItem('Ander project');
    render(<App />);
    await user.click(button('Nu versturen', await screen.findByRole('region', { name: 'Nog te versturen' })));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(button('Verder gaan').disabled).toBe(true);
    expect(button('Nu versturen').getAttribute('aria-busy')).toBe('true');

    await act(async () => answer(new Response(JSON.stringify({ status: 'verzonden' }), { status: 200 })));
    await user.click(await screen.findByRole('button', { name: 'Klaar' }));
    expect(button('Verder gaan').disabled).toBe(false);
    await user.click(button('Verder gaan'));
    await act(() => vi.advanceTimersByTimeAsync(300));
    await user.click(screen.getByText('Ja'));
    expect((await draftOnDisk())?.answers['1A']).toBe('ja');
  });

  test('back online on another screen: the banner is there when the technician is back on start', async () => {
    const user = setup();
    await seed();
    await user.click(await readyToSend(user));
    await screen.findByRole('heading', { name: 'Nog niet verstuurd' });
    act(() => {
      dispatchEvent(new Event('online'));
    });
    await user.click(button('Later versturen'));
    expect((await screen.findByRole('status')).textContent).toBe(BACK_ONLINE);
  });

  test('back online: a banner while there is something to send; gone when offline again', async () => {
    await outboxItem('Ander project');
    render(<App />);
    await screen.findByRole('region', { name: 'Nog te versturen' });
    expect(screen.queryByText(BACK_ONLINE)).toBeNull();

    act(() => {
      dispatchEvent(new Event('online'));
    });
    expect(screen.getByRole('status').textContent).toBe(BACK_ONLINE);
    act(() => {
      dispatchEvent(new Event('offline'));
    });
    expect(screen.queryByText(BACK_ONLINE)).toBeNull();
  });

  test('back online with an empty outbox: no banner', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Start inspectie' });
    act(() => {
      dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(BACK_ONLINE)).toBeNull();
  });
});
