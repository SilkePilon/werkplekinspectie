import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clear, createStore } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { amsterdamDateKey } from '@shared/dates';
import { QUESTION_IDS, type QuestionId } from '@shared/questions';
import type { Submission } from '@shared/schema';
import { App } from '../../src/client/App';
import { PhotoError, compressPhoto } from '../../src/client/photos/compress';
import { newDraft, toIsoWithOffset, type AnswerValue, type Draft, type NeeDetails } from '../../src/client/state/draft';
import { addToOutbox, loadDraft, saveDraft, setRememberedName } from '../../src/client/storage/db';

vi.mock('../../src/client/photos/compress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/client/photos/compress')>()),
  compressPhoto: vi.fn(),
}));

const Q1A = 'Heb je het VGM-handboekje bij je?';
const Q1B = 'Weet je wat je moet doen bij een noodgeval op deze plek?';
const Q1C = 'Heb je een veiligheidsinstructie van de opdrachtgever gekregen?';
const Q9B = 'Is er iemand met een EHBO-diploma?';
const FUTURE = '2099-12-31';
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

type Fetch = (input: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
let fetchMock: ReturnType<typeof vi.fn<Fetch>>;

beforeEach(async () => {
  // Only setTimeout is faked: fake-indexeddb schedules its work with setImmediate.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
  await clear(createStore('werkplekinspectie', 'kv'));
  fetchMock = vi.fn<Fetch>(async () => ({ ok: true, json: async () => ({ hasLogo: false }) }));
  vi.stubGlobal('fetch', fetchMock);
  history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(compressPhoto).mockReset();
});

function setup() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

async function tick(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

function radio(name: string): HTMLInputElement {
  return screen.getByRole('radio', { name }) as HTMLInputElement;
}

function button(name: string, within_: HTMLElement = document.body): HTMLButtonElement {
  return within(within_).getByRole('button', { name }) as HTMLButtonElement;
}

function neeDialog(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Wat is er mis?' });
}

const done = (comment = 'Kapot', photos: string[] = []): NeeDetails => ({ comment, actionBefore: FUTURE, photos });

/** Saves a draft started now with the given answers, as if the app was used before. */
async function seed(
  answers: Partial<Record<QuestionId, AnswerValue>>,
  nee: Partial<Record<QuestionId, NeeDetails>> = {},
): Promise<Draft> {
  const d: Draft = { ...newDraft('J. Jansen', 'Voorbeeld B.V.', 'P-1', new Date()), answers, nee };
  await saveDraft(d);
  return d;
}

const allJaExcept = (...skip: QuestionId[]) =>
  Object.fromEntries(QUESTION_IDS.filter((id) => !skip.includes(id)).map((id) => [id, 'ja'])) as Partial<
    Record<QuestionId, AnswerValue>
  >;

/** Answer taps are ignored for 300ms after a question appears (double-tap guard). */
async function settle() {
  await tick(300);
}

async function resume(user: ReturnType<typeof setup>) {
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Verder gaan' }));
  await settle();
}

async function fillStart(user: ReturnType<typeof setup>) {
  await user.type(await screen.findByLabelText('Naam'), 'J. Jansen');
  await user.type(screen.getByLabelText('Project'), 'Voorbeeld B.V.');
  await user.type(screen.getByLabelText('Projectnummer'), 'P-1');
}

describe('question flow', () => {
  test('start, Ja auto-advances, Nee needs details, reload resumes, back button works', async () => {
    const user = setup();
    const { unmount } = render(<App />);

    const start = await screen.findByRole('button', { name: 'Start inspectie' });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Vul eerst alle velden in.')).toBeTruthy();
    expect(screen.getByText('21 korte vragen. Duurt ongeveer 5 minuten.')).toBeTruthy();
    await fillStart(user);
    expect((start as HTMLButtonElement).disabled).toBe(false);
    await user.click(start);

    expect(screen.getByText(Q1A)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Vraag 1 van 21' })).toBeTruthy();
    expect(screen.getByText('Instructie')).toBeTruthy();

    await settle();
    await user.click(screen.getByText('Ja'));
    expect(radio('Ja').checked).toBe(true);
    expect(screen.getByText(Q1A)).toBeTruthy();
    await tick(300);
    expect(screen.getByText(Q1B)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Vraag 2 van 21' })).toBeTruthy();

    await settle();
    await user.click(screen.getByText('Nee'));
    const dialog = neeDialog();
    await user.click(button('Doorgaan', dialog));
    expect(within(dialog).getByText('Schrijf kort op wat er mis is.')).toBeTruthy();
    expect(within(dialog).getByText('Kies een datum.')).toBeTruthy();
    expect(screen.getByText(Q1B)).toBeTruthy();

    await user.type(within(dialog).getByRole('textbox', { name: 'Wat is er mis?' }), 'Geen plan aanwezig');
    fireEvent.change(within(dialog).getByLabelText('Opgelost vóór'), { target: { value: FUTURE } });
    await user.click(button('Doorgaan', dialog));
    expect(screen.getByText(Q1C)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    // Autosave runs ~300ms after the last change.
    await tick(300);
    await waitFor(async () => {
      const saved = await loadDraft();
      expect(saved?.answers).toEqual({ '1A': 'ja', '1B': 'nee' });
      expect(saved?.nee['1B']).toEqual({ comment: 'Geen plan aanwezig', actionBefore: FUTURE, photos: [] });
    });

    unmount();
    render(<App />);
    expect(await screen.findByText('Je bent nog bezig met een inspectie')).toBeTruthy();
    expect(screen.getByText('Hoi J. Jansen!')).toBeTruthy();
    await user.click(button('Verder gaan'));
    expect(screen.getByText(Q1C)).toBeTruthy();

    act(() => history.back());
    expect(await screen.findByText(Q1B)).toBeTruthy();
    expect(radio('Nee').checked).toBe(true);
  });

  test('a second tap within the delay changes the answer but advances only once', async () => {
    const user = setup();
    await seed({});
    await resume(user);
    await user.click(screen.getByText('Ja'));
    await tick(100);
    await user.click(screen.getByText('Niet van toepassing'));
    await tick(300);
    expect(screen.getByText(Q1B)).toBeTruthy();
    await tick(1000);
    expect(screen.getByText(Q1B)).toBeTruthy();
    await tick(300);
    await waitFor(async () => expect((await loadDraft())?.answers).toEqual({ '1A': 'nvt' }));
  });

  test('Nee within the delay cancels the pending advance and opens the sheet', async () => {
    const user = setup();
    await seed({});
    await resume(user);
    await user.click(screen.getByText('Ja'));
    await tick(100);
    await user.click(screen.getByText('Nee'));
    await tick(1000);
    expect(screen.getByText(Q1A)).toBeTruthy();
    expect(neeDialog()).toBeTruthy();
  });

  test('with reduced motion Ja advances at once; a double tap does not answer the next question', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' })),
    );
    const user = setup();
    await seed({});
    await resume(user);
    await user.click(screen.getByText('Ja'));
    expect(screen.getByText(Q1B)).toBeTruthy();
    // The second tap of the double tap lands on 1B's Ja.
    await user.click(screen.getByText('Ja'));
    expect(screen.getByText(Q1B)).toBeTruthy();
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);

    await settle();
    await user.click(screen.getByText('Ja'));
    expect(screen.getByText(Q1C)).toBeTruthy();
    await tick(300);
    await waitFor(async () => expect((await loadDraft())?.answers).toEqual({ '1A': 'ja', '1B': 'ja' }));
  });

  test('a failed save shows a lasting alert until a save works again', async () => {
    const user = setup();
    await seed({});
    await resume(user);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    await user.click(screen.getByText('Ja'));
    await tick(300);
    const message = 'Opslaan op deze telefoon lukt niet. Probeer het opnieuw of verwijder een foto.';
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(message);
    expect(screen.getByText(Q1B)).toBeTruthy();
    await tick(1000);
    expect(screen.getByText(message)).toBeTruthy();

    await user.click(screen.getByText('Ja'));
    await tick(300);
    await waitFor(() => expect(screen.queryByText(message)).toBeNull());
    expect((await loadDraft())?.answers).toEqual({ '1A': 'ja', '1B': 'ja' });
    put.mockRestore();
  });

  test('Volgende moves on from an answered question; X goes to start and keeps the draft', async () => {
    const user = setup();
    await seed({ '1A': 'ja' });
    await resume(user);
    expect(screen.getByText(Q1B)).toBeTruthy();
    expect(button('Volgende').disabled).toBe(true);

    act(() => history.back());
    expect(await screen.findByText(Q1A)).toBeTruthy();
    await user.click(button('Volgende'));
    expect(screen.getByText(Q1B)).toBeTruthy();

    await user.click(button('Terug naar start'));
    expect(screen.getByText('Je bent nog bezig met een inspectie')).toBeTruthy();
    expect((await loadDraft())?.answers).toEqual({ '1A': 'ja' });
  });

  test('closing the sheet keeps Nee but incomplete; Volgende opens it again', async () => {
    const user = setup();
    await seed({});
    await resume(user);
    await user.click(screen.getByText('Nee'));
    expect(neeDialog()).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(Q1A)).toBeTruthy();
    expect(radio('Nee').checked).toBe(true);

    await user.click(button('Volgende'));
    expect(neeDialog()).toBeTruthy();
    expect(screen.getByText(Q1A)).toBeTruthy();
  });

  test('Volgende on a Nee item with a date before the inspection day opens the sheet again', async () => {
    const user = setup();
    await seed({ ...allJaExcept('1A'), '1A': 'nee' }, { '1A': { comment: 'Kapot', actionBefore: '2000-01-01', photos: [] } });
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Verder gaan' }));
    await user.click(await screen.findByRole('button', { name: 'Overslaan' }));
    const card = (await screen.findByText(/^1A /)).closest('li')!;
    expect(within(card).getByText('Nog niet compleet')).toBeTruthy();
    expect(button('Alles klopt, naar tekenen').disabled).toBe(true);

    await user.click(button('Aanpassen', card));
    await settle();
    await user.click(button('Volgende'));
    expect(neeDialog()).toBeTruthy();
  });

  test('the date picker starts at the inspection day; earlier dates are refused', async () => {
    const user = setup();
    const d = await seed({});
    await resume(user);
    await user.click(screen.getByText('Nee'));
    const dialog = neeDialog();
    const date = within(dialog).getByLabelText('Opgelost vóór') as HTMLInputElement;
    expect(date.type).toBe('date');
    expect(date.min).toBe(amsterdamDateKey(d.startedAt));

    await user.type(within(dialog).getByRole('textbox', { name: 'Wat is er mis?' }), 'Kapot');
    fireEvent.change(date, { target: { value: '2000-01-01' } });
    await user.click(button('Doorgaan', dialog));
    expect(within(dialog).getByText('Kies een datum vanaf vandaag.')).toBeTruthy();
    expect(screen.getByText(Q1A)).toBeTruthy();

    fireEvent.change(date, { target: { value: amsterdamDateKey(d.startedAt) } });
    await user.click(button('Doorgaan', dialog));
    expect(screen.getByText(Q1B)).toBeTruthy();
  });

  test('a blank comment is refused and the remaining length shows near the limit', async () => {
    const user = setup();
    await seed({});
    await resume(user);
    await user.click(screen.getByText('Nee'));
    const dialog = neeDialog();
    const comment = within(dialog).getByRole('textbox', { name: 'Wat is er mis?' }) as HTMLTextAreaElement;
    expect(comment.maxLength).toBe(1000);
    fireEvent.change(comment, { target: { value: '   ' } });
    fireEvent.change(within(dialog).getByLabelText('Opgelost vóór'), { target: { value: FUTURE } });
    await user.click(button('Doorgaan', dialog));
    expect(within(dialog).getByText('Schrijf kort op wat er mis is.')).toBeTruthy();
    expect(within(dialog).queryByText(/tekens over/)).toBeNull();

    fireEvent.change(comment, { target: { value: 'x'.repeat(950) } });
    expect(within(dialog).getByText('Nog 50 tekens over.')).toBeTruthy();
  });

  test('after 9B comes "Wat gaat hier goed?"', async () => {
    const user = setup();
    await seed(allJaExcept('9B'));
    await resume(user);
    expect(screen.getByText(Q9B)).toBeTruthy();
    await user.click(screen.getByText('Ja'));
    await tick(300);
    expect(
      screen.getByRole('heading', { name: 'Wat gaat hier goed? Waar kan de rest van het bedrijf van leren?' }),
    ).toBeTruthy();
  });

  test('a question opened from the summary returns to the summary', async () => {
    const user = setup();
    await seed(allJaExcept());
    render(<App />);
    await screen.findByText('Je bent nog bezig met een inspectie');
    const state = { screen: { name: 'question', id: '4B', returnTo: 'summary' } };
    act(() => {
      history.pushState(state, '');
      dispatchEvent(new PopStateEvent('popstate', { state }));
    });
    expect(screen.getByText('Zijn de blusmiddelen gekeurd?')).toBeTruthy();
    await settle();
    await user.click(screen.getByText('Niet van toepassing'));
    await tick(300);
    expect(screen.getByRole('heading', { name: 'Klopt alles?' })).toBeTruthy();
  });

  test('a comment can be added before or after Ja, is saved, and shows in the summary', async () => {
    const user = setup();
    render(<App />);
    await fillStart(user);
    await user.click(await screen.findByRole('button', { name: 'Start inspectie' }));
    await settle();

    // Before answering: write the note, then Ja still auto-advances.
    await user.click(button('Opmerking toevoegen'));
    const dialog = screen.getByRole('dialog', { name: 'Opmerking' });
    expect(within(dialog).getByText('Niet verplicht. Mag kort.')).toBeTruthy();
    await user.type(within(dialog).getByRole('textbox', { name: 'Opmerking' }), 'Ligt in de bus');
    await user.click(button('Klaar', dialog));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(Q1A)).toBeTruthy();
    expect(screen.getByText('Ligt in de bus')).toBeTruthy();
    await user.click(screen.getByText('Ja'));
    await tick(300);
    expect(screen.getByText(Q1B)).toBeTruthy();

    // After answering: opening the note cancels the pending advance.
    await settle();
    await user.click(screen.getByText('Niet van toepassing'));
    await user.click(button('Opmerking toevoegen'));
    await tick(400);
    expect(screen.getByText(Q1B)).toBeTruthy();
    const second = screen.getByRole('dialog', { name: 'Opmerking' });
    await user.type(within(second).getByRole('textbox', { name: 'Opmerking' }), 'Geen plan nodig');
    await user.click(button('Klaar', second));
    expect(screen.getByText(Q1B)).toBeTruthy();
    await user.click(button('Volgende'));
    expect(screen.getByText(Q1C)).toBeTruthy();

    await tick(300);
    await waitFor(async () => {
      const saved = await loadDraft();
      expect(saved?.notes).toEqual({ '1A': 'Ligt in de bus', '1B': 'Geen plan nodig' });
    });
  });

  test('a comment written before Nee is the start of "Wat is er mis?"', async () => {
    const user = setup();
    await seed({});
    await resume(user);
    await user.click(button('Opmerking toevoegen'));
    const note = screen.getByRole('dialog', { name: 'Opmerking' });
    await user.type(within(note).getByRole('textbox', { name: 'Opmerking' }), 'Handboekje kwijt');
    await user.click(button('Klaar', note));
    await user.click(screen.getByText('Nee'));
    expect((within(neeDialog()).getByRole('textbox', { name: 'Wat is er mis?' }) as HTMLTextAreaElement).value).toBe(
      'Handboekje kwijt',
    );
    // The Nee sheet holds the comment now; no separate note control while the answer is Nee.
    await user.click(button('Doorgaan', neeDialog()));
    expect(screen.queryByRole('button', { name: 'Opmerking toevoegen' })).toBeNull();
  });

  test('the summary lists Ja/Nvt comments and opens the question to change one', async () => {
    const user = setup();
    const d = await seed(allJaExcept());
    await saveDraft({ ...d, notes: { '4B': 'Gekeurd in oktober' } });
    render(<App />);
    await screen.findByText('Je bent nog bezig met een inspectie');
    const state = { screen: { name: 'summary' } };
    act(() => {
      history.pushState(state, '');
      dispatchEvent(new PopStateEvent('popstate', { state }));
    });
    const section = screen.getByRole('region', { name: 'Opmerkingen' });
    await user.click(within(section).getByRole('button', { name: /Gekeurd in oktober/ }));
    expect(screen.getByText('Zijn de blusmiddelen gekeurd?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Aanpassen/ })).toBeTruthy();
  });

  test('the back arrow goes one question back, keeps the answer, and is not on the first question', async () => {
    const user = setup();
    render(<App />);
    await fillStart(user);
    await user.click(await screen.findByRole('button', { name: 'Start inspectie' }));
    expect(screen.queryByRole('button', { name: 'Vorige' })).toBeNull();
    await settle();
    await user.click(screen.getByText('Ja'));
    await tick(300);
    expect(screen.getByText(Q1B)).toBeTruthy();

    await user.click(button('Vorige'));
    await waitFor(() => expect(screen.getByText(Q1A)).toBeTruthy());
    expect(radio('Ja').checked).toBe(true);
    // The arrow reused the history entry: forward again with Volgende, then the phone's back.
    await user.click(button('Volgende'));
    expect(screen.getByText(Q1B)).toBeTruthy();
    act(() => history.back());
    await waitFor(() => expect(screen.getByText(Q1A)).toBeTruthy());
  });

  test('back right after tapping Ja cancels the pending auto-advance', async () => {
    const user = setup();
    await seed({ '1A': 'ja' });
    await resume(user);
    expect(screen.getByText(Q1B)).toBeTruthy();
    await user.click(screen.getByText('Ja'));
    await user.click(button('Vorige'));
    await tick(400);
    expect(screen.getByText(Q1A)).toBeTruthy();
  });

  test('after resuming, back walks the earlier questions without leaving the app', async () => {
    const user = setup();
    await seed({ '1A': 'ja', '1B': 'nvt' });
    await resume(user);
    expect(screen.getByText(Q1C)).toBeTruthy();
    await user.click(button('Vorige'));
    await waitFor(() => expect(screen.getByText(Q1B)).toBeTruthy());
    await user.click(button('Vorige'));
    await waitFor(() => expect(screen.getByText(Q1A)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Vorige' })).toBeNull();
  });

  test('back from the summary and from a question opened from it', async () => {
    const user = setup();
    await seed(allJaExcept());
    render(<App />);
    await screen.findByText('Je bent nog bezig met een inspectie');
    // Opened straight from the address bar's history: no matching previous entry.
    const state = { screen: { name: 'summary' } };
    act(() => {
      history.pushState(state, '');
      dispatchEvent(new PopStateEvent('popstate', { state }));
    });
    await user.click(screen.getByRole('button', { name: /^4 Brandpreventie/ }));
    expect(screen.getByText('Zijn er blusmiddelen, en kun je erbij?')).toBeTruthy();
    await user.click(button('Vorige'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Klopt alles?' })).toBeTruthy());

    await user.click(button('Vorige'));
    await waitFor(() => expect(screen.getByRole('heading', { name: /Wat gaat hier goed/ })).toBeTruthy());
    await user.click(button('Vorige'));
    await waitFor(() => expect(screen.getByText(Q9B)).toBeTruthy());
  });

  test('autosave is flushed at once when the page is hidden', async () => {
    const user = setup();
    await seed({});
    await resume(user);
    await user.click(screen.getByText('Nee'));
    // Uninstalling the fake clock drops the pending debounce timer: only a flush can save now.
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    try {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      // IndexedDB runs the read after the flushed write.
      expect((await loadDraft())?.answers).toEqual({ '1A': 'nee' });
    } finally {
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });
});

describe('photos', () => {
  async function openSheet(user: ReturnType<typeof setup>) {
    await resume(user);
    await user.click(screen.getByText('Nee'));
    const dialog = neeDialog();
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    return { dialog, input };
  }

  const file = () => new File([new Uint8Array([1])], 'foto.jpg', { type: 'image/jpeg' });

  test('adds compressed photos as removable thumbnails, at most 3 per question', async () => {
    vi.mocked(compressPhoto).mockResolvedValue(PHOTO);
    const user = setup();
    await seed({});
    const { dialog, input } = await openSheet(user);
    expect(input.accept).toBe('image/*');
    expect(input.hasAttribute('capture')).toBe(false);

    for (let i = 0; i < 3; i++) await user.upload(input, file());
    await waitFor(() => expect(within(dialog).getAllByRole('button', { name: 'Foto verwijderen' })).toHaveLength(3));
    expect(button('Foto', dialog).disabled).toBe(true);
    expect(within(dialog).getByText("Maximaal 3 foto's per vraag.")).toBeTruthy();

    await user.click(within(dialog).getAllByRole('button', { name: 'Foto verwijderen' })[0]!);
    expect(within(dialog).getAllByRole('button', { name: 'Foto verwijderen' })).toHaveLength(2);
    expect(button('Foto', dialog).disabled).toBe(false);
    await tick(300);
    await waitFor(async () => expect((await loadDraft())?.nee['1A']?.photos).toEqual([PHOTO, PHOTO]));
  });

  test('at most 15 photos in the whole inspection', async () => {
    const user = setup();
    const three = [PHOTO, PHOTO, PHOTO];
    await seed(
      { '1A': 'nee', '1B': 'nee', '1C': 'nee', '1D': 'nee', '2A': 'nee', '2B': 'ja' },
      { '1A': done('a', three), '1B': done('b', three), '1C': done('c', three), '1D': done('d', three), '2A': done('e', three) },
    );
    const { dialog } = await openSheet(user);
    expect(screen.getByText('Is de werkplek veilig en goed afgezet?')).toBeTruthy();
    expect(button('Foto', dialog).disabled).toBe(true);
    expect(within(dialog).getByText("Maximaal 15 foto's per inspectie.")).toBeTruthy();
  });

  test('photos of an item changed back to Ja do not count', async () => {
    const user = setup();
    const three = [PHOTO, PHOTO, PHOTO];
    await seed(
      { '1A': 'nee', '1B': 'nee', '1C': 'nee', '1D': 'nee', '2A': 'ja', '2B': 'ja' },
      { '1A': done('a', three), '1B': done('b', three), '1C': done('c', three), '1D': done('d', three), '2A': done('e', three) },
    );
    const { dialog } = await openSheet(user);
    expect(button('Foto', dialog).disabled).toBe(false);
    expect(within(dialog).queryByText(/Maximaal/)).toBeNull();
  });

  test('Nee again with kept photos that go over 15 in total: Doorgaan asks to remove photos first', async () => {
    const user = setup();
    const three = [PHOTO, PHOTO, PHOTO];
    // 2A was Nee with 3 photos, then answered again; its details are kept.
    await seed(
      { '1A': 'nee', '1B': 'nee', '1C': 'nee', '1D': 'nee', '2B': 'nee' },
      { '1A': done('a', three), '1B': done('b', three), '1C': done('c', three), '1D': done('d', three), '2A': done('e', three), '2B': done('f', three) },
    );
    const { dialog } = await openSheet(user);
    expect(screen.getByText('Is je werkplek goed bereikbaar, opgeruimd en verlicht?')).toBeTruthy();
    expect(within(dialog).getAllByRole('button', { name: 'Foto verwijderen' })).toHaveLength(3);
    await user.click(button('Doorgaan', dialog));
    expect(within(dialog).getByText("Je hebt te veel foto's. Verwijder er 3.")).toBeTruthy();
    expect(neeDialog()).toBeTruthy();

    for (let i = 0; i < 3; i++) await user.click(within(dialog).getAllByRole('button', { name: 'Foto verwijderen' })[0]!);
    await user.click(button('Doorgaan', dialog));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a photo that finishes after the answer changed away from Nee is dropped', async () => {
    let finish: (url: string) => void = () => undefined;
    vi.mocked(compressPhoto).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = setup();
    await seed({});
    const { input } = await openSheet(user);
    await user.upload(input, file());
    await user.keyboard('{Escape}');
    await user.click(screen.getByText('Ja'));
    await act(async () => finish(PHOTO));
    await tick(300);
    expect(screen.getByText(Q1B)).toBeTruthy();
    await waitFor(async () => expect((await loadDraft())?.answers).toEqual({ '1A': 'ja' }));
    expect((await loadDraft())?.nee['1A']?.photos ?? []).toEqual([]);
  });

  test('a photo that cannot be used shows the reason', async () => {
    vi.mocked(compressPhoto).mockRejectedValue(new PhotoError());
    const user = setup();
    await seed({});
    const { dialog, input } = await openSheet(user);
    await user.upload(input, file());
    expect(await within(dialog).findByText('Deze foto kan niet gebruikt worden. Maak een nieuwe foto.')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Foto verwijderen' })).toBeNull();
  });
});

describe('start screen', () => {
  test('shows the logo only when the server has one', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ hasLogo: true }) });
    const { container, unmount } = render(<App />);
    await waitFor(() => expect(container.querySelector('img[src="/api/branding/logo"]')).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('/api/branding', expect.anything());
    unmount();

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const second = render(<App />);
    await screen.findByLabelText('Naam');
    expect(screen.getByRole('heading', { name: 'Werkplekinspectie' })).toBeTruthy();
    expect(second.container.querySelector('img')).toBeNull();
  });

  test('a remembered name greets; Aanpassen shows the field; the name is saved on start', async () => {
    await setRememberedName('J. Jansen');
    const user = setup();
    render(<App />);
    expect(await screen.findByText('Hoi J. Jansen!')).toBeTruthy();
    expect(screen.queryByLabelText('Naam')).toBeNull();
    await user.click(button('Naam aanpassen'));
    const naam = screen.getByLabelText('Naam') as HTMLInputElement;
    expect(naam.value).toBe('J. Jansen');
    expect(naam.maxLength).toBe(80);
    expect((screen.getByLabelText('Project') as HTMLInputElement).maxLength).toBe(120);
    expect((screen.getByLabelText('Projectnummer') as HTMLInputElement).maxLength).toBe(40);
    await user.clear(naam);
    await user.type(naam, 'A. de Vries');
    await user.type(screen.getByLabelText('Project'), 'Voorbeeld B.V.');
    await user.type(screen.getByLabelText('Projectnummer'), 'P-2');
    await user.click(button('Start inspectie'));
    expect(screen.getByText(Q1A)).toBeTruthy();
    await tick(300);
    await waitFor(async () => {
      const saved = await loadDraft();
      expect(saved).toMatchObject({ monteur: 'A. de Vries', project: 'Voorbeeld B.V.', projectnummer: 'P-2' });
    });
  });

  test('blank fields keep Start disabled', async () => {
    const user = setup();
    render(<App />);
    await user.type(await screen.findByLabelText('Naam'), '   ');
    await user.type(screen.getByLabelText('Project'), 'X');
    await user.type(screen.getByLabelText('Projectnummer'), 'P-1');
    expect(button('Start inspectie').disabled).toBe(true);
  });

  test('the honeypot is hidden from people, skipped by password managers, and ends up in the draft', async () => {
    const user = setup();
    const { container } = render(<App />);
    await fillStart(user);
    // A meaningless name: autofill would happily fill a field called `website`.
    expect(container.querySelector('input[name="website"]')).toBeNull();
    const honeypot = container.querySelector('input[name="hp_ref"]') as HTMLInputElement;
    expect(honeypot.tabIndex).toBe(-1);
    expect(honeypot.getAttribute('aria-hidden')).toBe('true');
    expect(honeypot.autocomplete).toBe('off');
    expect(honeypot.hasAttribute('data-1p-ignore')).toBe(true);
    expect(honeypot.hasAttribute('data-bwignore')).toBe(true);
    expect(honeypot.getAttribute('data-lpignore')).toBe('true');
    expect(honeypot.getAttribute('data-form-type')).toBe('other');
    fireEvent.change(honeypot, { target: { value: 'spam' } });
    await user.click(button('Start inspectie'));
    await tick(300);
    await waitFor(async () => expect((await loadDraft())?.website).toBe('spam'));
  });

  test('Weggooien asks first, then removes the draft', async () => {
    const user = setup();
    await seed({ '1A': 'ja' });
    await setRememberedName('J. Jansen');
    render(<App />);
    expect(await screen.findByText('Hoi J. Jansen!')).toBeTruthy();
    // Changing the name only matters for a new inspection.
    expect(screen.queryByRole('button', { name: 'Naam aanpassen' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Weggooien' }));
    const dialog = screen.getByRole('dialog', { name: 'Inspectie weggooien?' });
    await user.click(button('Terug', dialog));
    expect(screen.getByText('Je bent nog bezig met een inspectie')).toBeTruthy();
    expect(await loadDraft()).not.toBeNull();

    await user.click(button('Weggooien'));
    await user.click(button('Weggooien', screen.getByRole('dialog', { name: 'Inspectie weggooien?' })));
    expect(screen.queryByText('Je bent nog bezig met een inspectie')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start inspectie' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Naam aanpassen' })).toBeTruthy();
    await waitFor(async () => expect(await loadDraft()).toBeNull());
  });

  test('a draft untouched for 15 days is gone at app start', async () => {
    const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await saveDraft({ ...newDraft('J. Jansen', 'X', 'P-1', old), updatedAt: toIsoWithOffset(old) });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Start inspectie' })).toBeTruthy();
    expect(screen.queryByText('Je bent nog bezig met een inspectie')).toBeNull();
    expect(await loadDraft()).toBeNull();
  });

  test('unsent inspections are listed under "Nog te versturen"', async () => {
    await addToOutbox({
      submissionId: 'a',
      monteur: 'J. Jansen',
      project: 'Voorbeeld B.V.',
      projectnummer: 'P-9',
      startedAt: '2026-11-20T09:12:00+01:00',
    } as Submission);
    render(<App />);
    const list = await screen.findByRole('region', { name: 'Nog te versturen' });
    expect(within(list).getByText(/Voorbeeld B.V./)).toBeTruthy();
    expect(within(list).getByRole('button', { name: 'Nu versturen' })).toBeTruthy();
  });
});
