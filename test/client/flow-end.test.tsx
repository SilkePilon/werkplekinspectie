import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clear, createStore } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { QUESTION_IDS, type QuestionId } from '@shared/questions';
import type { Submission } from '@shared/schema';
import { App, type Screen } from '../../src/client/App';
import { newDraft, type AnswerValue, type Draft, type NeeDetails } from '../../src/client/state/draft';
import { listOutbox, loadDraft, saveDraft } from '../../src/client/storage/db';

// jsdom has no canvas: a stand-in signature pad the tests can steer.
const pad = vi.hoisted(() => ({
  empty: true,
  data: [] as unknown[],
  /** Return values for the next toDataURL calls; afterwards SIGNATURE. */
  urls: [] as string[],
  options: undefined as unknown,
  listeners: new Set<() => void>(),
  fromData: [] as unknown[][],
  toDataURL: [] as unknown[],
}));

vi.mock('signature_pad', () => ({
  default: class {
    constructor(_canvas: HTMLCanvasElement, options: unknown) {
      pad.options = options;
    }
    isEmpty() {
      return pad.empty;
    }
    toData() {
      return pad.data;
    }
    fromData(data: unknown[]) {
      pad.fromData.push(data);
      pad.data = [...data];
      pad.empty = data.length === 0;
    }
    clear() {
      pad.data = [];
      pad.empty = true;
    }
    toDataURL(type?: string) {
      pad.toDataURL.push(type);
      return pad.urls.shift() ?? SIGNATURE;
    }
    addEventListener(type: string, fn: () => void) {
      if (type === 'endStroke') pad.listeners.add(fn);
    }
    removeEventListener(type: string, fn: () => void) {
      if (type === 'endStroke') pad.listeners.delete(fn);
    }
    off() {}
  },
}));

const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';
/** Decodes to more than 300 KB. */
const HUGE = `data:image/png;base64,${'A'.repeat(400_001)}`;
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const Q4A = 'Zijn er blusmiddelen, en kun je erbij?';
const Q4B = 'Zijn de blusmiddelen gekeurd?';
const GOOD = 'Wat gaat hier goed? Waar kan de rest van het bedrijf van leren?';
const DECLARATION = 'Ik heb deze inspectie zelf gedaan en de antwoorden kloppen.';

let scale: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  // Only setTimeout is faked: fake-indexeddb schedules its work with setImmediate.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  await clear(createStore('werkplekinspectie', 'kv'));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ hasLogo: false }) })));
  history.replaceState(null, '', '/');
  Object.assign(pad, { empty: true, data: [], urls: [], options: undefined, fromData: [], toDataURL: [] });
  pad.listeners.clear();
  scale = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

async function tick(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

function button(name: string | RegExp, in_: HTMLElement = document.body): HTMLButtonElement {
  return within(in_).getByRole('button', { name }) as HTMLButtonElement;
}

const allJa = () =>
  Object.fromEntries(QUESTION_IDS.map((id) => [id, 'ja'])) as Partial<Record<QuestionId, AnswerValue>>;

async function seed(
  answers: Partial<Record<QuestionId, AnswerValue>>,
  nee: Partial<Record<QuestionId, NeeDetails>> = {},
  extra: Partial<Draft> = {},
): Promise<Draft> {
  const d: Draft = { ...newDraft('J. Jansen', 'Voorbeeld B.V.', 'P-1', new Date()), answers, nee, ...extra };
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

const nee4B = (over: Partial<NeeDetails> = {}): NeeDetails => ({
  comment: 'Sticker op blusser is van 2023.',
  actionBefore: '2099-12-04',
  photos: [PHOTO],
  ...over,
});

function summaryButton() {
  return button('Alles klopt, naar tekenen');
}

/** The signed inspection, once sending has put it in the outbox. */
async function queued(): Promise<Submission> {
  let out: Submission[] = [];
  await waitFor(async () => {
    out = await listOutbox();
    expect(out).toHaveLength(1);
  });
  return out[0]!;
}

async function saved(): Promise<Draft> {
  await tick(300);
  let d: Draft | null = null;
  await waitFor(async () => {
    d = await loadDraft();
    expect(d).not.toBeNull();
  });
  return d!;
}

describe('good practice', () => {
  test('after the questions; Overslaan clears the text and goes to the summary', async () => {
    const user = setup();
    await seed(allJa(), {}, { goodPractice: 'Oude tekst' });
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Verder gaan' }));
    expect(screen.getByRole('heading', { name: GOOD })).toBeTruthy();
    expect(screen.getByText('Nog één vraag')).toBeTruthy();
    expect(screen.getByText('Mag kort. Je mag dit ook overslaan.')).toBeTruthy();

    await user.click(button('Overslaan'));
    expect(screen.getByRole('heading', { name: 'Klopt alles?' })).toBeTruthy();
    await waitFor(async () => expect((await saved()).goodPractice).toBe(''));
  });

  test('typed text is kept; the summary row opens it and Volgende returns to the summary', async () => {
    const user = setup();
    await seed(allJa());
    await openAt({ name: 'goodPractice' });
    const text = screen.getByRole('textbox', { name: GOOD }) as HTMLTextAreaElement;
    expect(text.maxLength).toBe(250);
    expect(screen.queryByText(/tekens over/)).toBeNull();
    fireEvent.change(text, { target: { value: 'x'.repeat(170) } });
    expect(screen.getByText('Nog 80 tekens over.')).toBeTruthy();
    fireEvent.change(text, { target: { value: '' } });
    await user.type(text, 'Elke ochtend een toolbox.');
    await user.click(button('Volgende'));
    expect(screen.getByRole('heading', { name: 'Klopt alles?' })).toBeTruthy();
    expect(screen.getByText('Elke ochtend een toolbox.')).toBeTruthy();

    await user.click(button(/Wat gaat hier goed\?/));
    expect((history.state as { screen: unknown }).screen).toEqual({ name: 'goodPractice', returnTo: 'summary' });
    expect((screen.getByRole('textbox', { name: GOOD }) as HTMLTextAreaElement).value).toBe(
      'Elke ochtend een toolbox.',
    );
    await user.click(button('Volgende'));
    expect(screen.getByRole('heading', { name: 'Klopt alles?' })).toBeTruthy();
    expect((await saved()).goodPractice).toBe('Elke ochtend een toolbox.');
  });
});

describe('summary', () => {
  test('counts, Nee items with comment, date and photos, and the sections', async () => {
    await seed({ ...allJa(), '4B': 'nee', '7A': 'nvt' }, { '4B': nee4B() });
    await openAt({ name: 'summary' });
    expect(screen.getByRole('heading', { name: 'Klopt alles?' })).toBeTruthy();
    expect(screen.getByText('19 × Ja')).toBeTruthy();
    expect(screen.getByText('1 × Nee')).toBeTruthy();
    expect(screen.getByText('1 × Nvt')).toBeTruthy();

    const nee = screen.getByRole('region', { name: 'Niet in orde' });
    expect(within(nee).getByText(`4B ${Q4B}`)).toBeTruthy();
    expect(within(nee).getByText('Sticker op blusser is van 2023.')).toBeTruthy();
    expect(within(nee).getByText('Vóór 4 dec, 1 foto')).toBeTruthy();
    expect(within(nee).queryByText('Nog niet compleet')).toBeNull();

    const all = screen.getByRole('region', { name: 'Alle onderdelen' });
    expect(within(all).getByText('2 × Ja, 1 × Nee')).toBeTruthy();
    expect(button(/^7 Hygiëne/, all).textContent).toContain('1 × Ja, 1 × Nvt');
    expect(button(/^1 Instructie/, all).textContent).toContain('4 × Ja');
    expect(summaryButton().disabled).toBe(false);
  });

  test('photo count in plural', async () => {
    await seed({ ...allJa(), '4B': 'nee' }, { '4B': nee4B({ photos: [PHOTO, PHOTO] }) });
    await openAt({ name: 'summary' });
    expect(screen.getByText("Vóór 4 dec, 2 foto's")).toBeTruthy();
  });

  test('Aanpassen on 4B, change to Ja: back on the summary with 0 × Nee', async () => {
    const user = setup();
    await seed({ ...allJa(), '4B': 'nee' }, { '4B': nee4B() });
    await openAt({ name: 'summary' });
    await user.click(button('Aanpassen', screen.getByRole('region', { name: 'Niet in orde' })));
    expect(screen.getByText(Q4B)).toBeTruthy();
    expect((history.state as { screen: unknown }).screen).toEqual({ name: 'question', id: '4B', returnTo: 'summary' });

    await tick(300);
    await user.click(screen.getByText('Ja'));
    await user.click(button('Volgende'));
    expect(screen.getByRole('heading', { name: 'Klopt alles?' })).toBeTruthy();
    expect(screen.getByText('21 × Ja')).toBeTruthy();
    expect(screen.getByText('0 × Nee')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Niet in orde' })).toBeNull();
    expect((await saved()).answers['4B']).toBe('ja');
  });

  test('tapping "4 Brandpreventie" opens 4A and comes back to the summary', async () => {
    const user = setup();
    await seed(allJa());
    await openAt({ name: 'summary' });
    await user.click(button(/^4 Brandpreventie/));
    expect(screen.getByText(Q4A)).toBeTruthy();
    expect((history.state as { screen: unknown }).screen).toEqual({ name: 'question', id: '4A', returnTo: 'summary' });

    await tick(300);
    await user.click(screen.getByText('Niet van toepassing'));
    await user.click(button('Volgende'));
    expect(screen.getByRole('heading', { name: 'Klopt alles?' })).toBeTruthy();
    expect(screen.getByText('1 × Nvt')).toBeTruthy();
  });

  test('an incomplete Nee item blocks signing and says why', async () => {
    const user = setup();
    await seed({ ...allJa(), '4B': 'nee', '3A': 'nee' }, { '4B': nee4B({ comment: '  ' }), '3A': nee4B({ actionBefore: '' }) });
    await openAt({ name: 'summary' });
    const nee = screen.getByRole('region', { name: 'Niet in orde' });
    expect(within(nee).getAllByText('Nog niet compleet')).toHaveLength(2);
    expect(within(nee).getByText('1 foto')).toBeTruthy();
    expect(summaryButton().disabled).toBe(true);
    expect(screen.getByText('Nog 2 punten zijn niet compleet. Maak die eerst af.')).toBeTruthy();
    expect(summaryButton().getAttribute('aria-describedby')).toBeTruthy();

    await user.click(within(nee).getAllByRole('button', { name: 'Aanpassen' })[0]!);
    expect(screen.getByText('Zijn je gereedschap en klimmaterieel in goede staat?')).toBeTruthy();
  });

  test('an unanswered question also blocks signing', async () => {
    const answers = allJa();
    delete answers['9B'];
    await seed(answers);
    await openAt({ name: 'summary' });
    expect(summaryButton().disabled).toBe(true);
    expect(screen.getByText('Nog 1 punt is niet compleet. Maak dat eerst af.')).toBeTruthy();
    expect(button(/^9 EHBO/).textContent).toContain('Nog niet compleet');
  });

  test('tapping "9 EHBO" with 9B unanswered opens 9B and comes back to the summary', async () => {
    const user = setup();
    const answers = allJa();
    delete answers['9B'];
    await seed(answers);
    await openAt({ name: 'summary' });
    await user.click(button(/^9 EHBO/));
    expect(screen.getByText('Is er iemand met een EHBO-diploma?')).toBeTruthy();
    expect((history.state as { screen: unknown }).screen).toEqual({ name: 'question', id: '9B', returnTo: 'summary' });

    await tick(300);
    await user.click(screen.getByText('Ja'));
    await user.click(button('Volgende'));
    expect(screen.getByRole('heading', { name: 'Klopt alles?' })).toBeTruthy();
    expect(summaryButton().disabled).toBe(false);
  });

  test('"Alles klopt, naar tekenen" opens the signature screen', async () => {
    const user = setup();
    await seed(allJa());
    await openAt({ name: 'summary' });
    await user.click(summaryButton());
    expect(screen.getByRole('heading', { name: 'Zet je handtekening' })).toBeTruthy();
  });

  test('the back arrow on the signature screen returns to the summary', async () => {
    const user = setup();
    await seed(allJa());
    await openAt({ name: 'summary' });
    await user.click(summaryButton());
    await user.click(button('Vorige'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Klopt alles?' })).toBeTruthy());
  });
});

describe('signature', () => {
  function draw(points: unknown[] = [{ points: [{ x: 1, y: 2, time: 0, pressure: 0.5 }] }]) {
    pad.empty = false;
    pad.data = points;
    act(() => pad.listeners.forEach((fn) => fn()));
  }

  test('Verstuur inspectie needs a drawn signature and the ticked declaration', async () => {
    const user = setup();
    await seed(allJa());
    await openAt({ name: 'signature' });
    expect(screen.getByRole('heading', { name: 'Zet je handtekening' })).toBeTruthy();
    expect(screen.getByText(/^J\. Jansen, \d{1,2} [a-z]{3} \d{4}$/)).toBeTruthy();
    const send = button('Verstuur inspectie');
    const box = screen.getByRole('checkbox', { name: DECLARATION }) as HTMLInputElement;
    expect(send.disabled).toBe(true);

    draw();
    expect(send.disabled).toBe(true);
    await user.click(screen.getByText(DECLARATION));
    expect(box.checked).toBe(true);
    expect(send.disabled).toBe(false);

    await user.click(button('Opnieuw'));
    expect(send.disabled).toBe(true);
    draw();
    await user.click(box);
    expect(send.disabled).toBe(true);
    await user.click(box);
    expect(send.disabled).toBe(false);

    await user.click(send);
    expect(pad.toDataURL).toEqual(['image/png']);
    const s = await queued();
    expect(s.signature).toBe(SIGNATURE);
    expect(s.signedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    expect(s.declaration).toBe(true);
  });

  test('the pen suits a finger and uses the ink colour', async () => {
    await seed(allJa());
    await openAt({ name: 'signature' });
    expect(pad.options).toMatchObject({ penColor: '#26193c' });
    const { minWidth, maxWidth } = pad.options as { minWidth: number; maxWidth: number };
    expect(minWidth).toBeGreaterThanOrEqual(1);
    expect(maxWidth).toBeGreaterThan(minWidth);
  });

  test('the canvas is scaled by devicePixelRatio and keeps its strokes on resize', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(230);
    await seed(allJa());
    await openAt({ name: 'signature' });
    const canvas = document.querySelector('canvas')!;
    expect([canvas.width, canvas.height]).toEqual([600, 460]);
    expect(scale).toHaveBeenLastCalledWith(2, 2);

    const strokes = [{ points: [{ x: 5, y: 5, time: 1, pressure: 0.5 }] }];
    draw(strokes);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400);
    act(() => {
      dispatchEvent(new Event('resize'));
    });
    expect(canvas.width).toBe(800);
    expect(pad.fromData.at(-1)).toEqual(strokes);
    expect(button('Verstuur inspectie').disabled).toBe(true);
  });

  test('a too large signature is exported again at scale 1', async () => {
    vi.stubGlobal('devicePixelRatio', 3);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(300);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(230);
    const user = setup();
    await seed(allJa(), {}, { declaration: true });
    await openAt({ name: 'signature' });
    const canvas = document.querySelector('canvas')!;
    const sizes: number[] = [];
    pad.urls = [HUGE];
    const toDataURL = pad.toDataURL;
    toDataURL.push = (...items: unknown[]) => {
      sizes.push(canvas.width);
      return Array.prototype.push.apply(toDataURL, items);
    };
    draw();
    await user.click(button('Verstuur inspectie'));
    expect(sizes).toEqual([900, 300]);
    expect(canvas.width).toBe(900);
    expect((await queued()).signature).toBe(SIGNATURE);
  });

  test('a signature that stays too large shows an error and is not saved', async () => {
    const user = setup();
    await seed(allJa(), {}, { declaration: true });
    await openAt({ name: 'signature' });
    pad.urls = [HUGE, HUGE];
    draw();
    await user.click(button('Verstuur inspectie'));
    expect(screen.getByRole('alert').textContent).toBe(
      'Je handtekening is te groot. Tik op Opnieuw en teken hem nog een keer.',
    );
    expect((await saved()).signature).toBeUndefined();
    fireEvent.click(button('Opnieuw'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
