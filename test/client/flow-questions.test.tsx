import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clear, createStore } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { amsterdamDateKey, formatDayLong } from '@shared/dates';
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
const todayKey = () => amsterdamDateKey(new Date().toISOString());
/** The date field of the open Nee sheet: the phone's own date picker. */
const dateInput = (dialog: HTMLElement) => within(dialog).getByLabelText('Opgelost vóór') as HTMLInputElement;
/** Picks today in the open Nee sheet, as the phone's date picker would. */
const pickToday = (dialog: HTMLElement) => fireEvent.change(dateInput(dialog), { target: { value: todayKey() } });
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
  await user.type(await screen.findByLabelText('Jouw naam'), 'J. Jansen');
  await user.type(screen.getByLabelText('Project'), 'Voorbeeld B.V.');
  await user.type(screen.getByLabelText('Projectnummer'), 'P-1');
}

describe('question flow', () => {
  test('start, Ja waits for Volgende, Nee needs details, reload resumes, back button works', async () => {
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
    // An answer never moves on by itself.
    await tick(1000);
    expect(screen.getByText(Q1A)).toBeTruthy();
    await user.click(button('Volgende'));
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
    pickToday(dialog);
    await user.click(button('Doorgaan', dialog));
    // Doorgaan closes the sheet; Volgende moves on.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(Q1B)).toBeTruthy();
    expect(radio('Nee').checked).toBe(true);
    // What was filled in shows on the question, so it is clear it is kept; the card reopens the sheet.
    const card = screen.getByRole('button', { name: /^Wat is er mis\?/ });
    expect(card.textContent).toContain('Geen plan aanwezig');
    expect(card.textContent).toContain(`Opgelost vóór ${formatDayLong(todayKey())}`);
    expect(card.textContent).not.toContain('Nog niet compleet');
    await user.click(card);
    expect(neeDialog()).toBeTruthy();
    await user.click(button('Doorgaan', neeDialog()));
    await user.click(button('Volgende'));
    expect(screen.getByText(Q1C)).toBeTruthy();

    // Autosave runs ~300ms after the last change.
    await tick(300);
    await waitFor(async () => {
      const saved = await loadDraft();
      expect(saved?.answers).toEqual({ '1A': 'ja', '1B': 'nee' });
      expect(saved?.nee['1B']).toEqual({ comment: 'Geen plan aanwezig', actionBefore: todayKey(), photos: [] });
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

  test('changing the answer before Volgende keeps the last one', async () => {
    const user = setup();
    await seed({});
    await resume(user);
    await user.click(screen.getByText('Ja'));
    await user.click(screen.getByText('Niet van toepassing'));
    await tick(1000);
    expect(screen.getByText(Q1A)).toBeTruthy();
    await user.click(button('Volgende'));
    expect(screen.getByText(Q1B)).toBeTruthy();
    await tick(300);
    await waitFor(async () => expect((await loadDraft())?.answers).toEqual({ '1A': 'nvt' }));
  });

  test('Nee after Ja opens the sheet on the same question', async () => {
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

  test('a tap right after Volgende does not answer the next question', async () => {
    const user = setup();
    await seed({});
    await resume(user);
    await user.click(screen.getByText('Ja'));
    await user.click(button('Volgende'));
    expect(screen.getByText(Q1B)).toBeTruthy();
    // A tap that lands on 1B's Ja straight away is ignored.
    await user.click(screen.getByText('Ja'));
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false);

    await settle();
    await user.click(screen.getByText('Ja'));
    await user.click(button('Volgende'));
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
    await user.click(button('Volgende'));
    expect(screen.getByText(Q1B)).toBeTruthy();
    await tick(1000);
    expect(screen.getByText(message)).toBeTruthy();

    await settle();
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
    const card = await screen.findByRole('button', { name: /^Instructie/ });
    expect(card.textContent).toBe('InstructieNog niet af');
    expect(button('Alles klopt, naar tekenen').disabled).toBe(true);

    await user.click(card);
    await settle();
    await user.click(button('Volgende'));
    expect(neeDialog()).toBeTruthy();
  });

  test('a Nee sheet closed before it is complete: the card says so, and tapping it reopens the sheet', async () => {
    const user = setup();
    await seed({});
    await resume(user);
    await user.click(screen.getByText('Nee'));
    await user.type(within(neeDialog()).getByRole('textbox', { name: 'Wat is er mis?' }), 'Kabel los');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    const card = screen.getByRole('button', { name: /^Wat is er mis\?/ });
    expect(card.textContent).toContain('Kabel los');
    expect(card.textContent).toContain('Geen datum');
    expect(card.textContent).toContain('Nog niet compleet');
    await user.click(card);
    expect(neeDialog()).toBeTruthy();
  });

  test('the date field: the phone\'s own picker, from the inspection day on, shown in words', async () => {
    const user = setup();
    const d = await seed({});
    const min = amsterdamDateKey(d.startedAt);
    await resume(user);
    await user.click(screen.getByText('Nee'));
    const dialog = neeDialog();
    // Plain black title, no red cross.
    expect(within(dialog).getByRole('heading', { name: 'Wat is er mis?' }).className).toContain('text-ink');
    // Photos are optional, and the button says so to screen readers too.
    const photo = button('Foto toevoegen', dialog);
    const described = photo.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain('Niet verplicht');

    const input = dateInput(dialog);
    expect(input.type).toBe('date');
    expect(input.min).toBe(todayKey() > min ? todayKey() : min);
    expect(within(dialog).getByText('Kies een datum')).toBeTruthy();

    await user.type(within(dialog).getByRole('textbox', { name: 'Wat is er mis?' }), 'Kapot');
    pickToday(dialog);
    const words = formatDayLong(todayKey());
    expect(within(dialog).getByText(words)).toBeTruthy();
    await user.click(button('Doorgaan', dialog));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(button('Volgende'));
    expect(screen.getByText(Q1B)).toBeTruthy();
  });

  test('a date typed before today is refused', async () => {
    const user = setup();
    await seed({});
    await resume(user);
    await user.click(screen.getByText('Nee'));
    const dialog = neeDialog();
    await user.type(within(dialog).getByRole('textbox', { name: 'Wat is er mis?' }), 'Kapot');
    fireEvent.change(dateInput(dialog), { target: { value: '2020-01-01' } });
    await user.click(button('Doorgaan', dialog));
    expect(within(dialog).getByText('Kies een datum vanaf vandaag.')).toBeTruthy();
    expect(dateInput(dialog).getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(dateInput(dialog));
  });

  test('a blank comment is refused and the remaining length shows near the limit', async () => {
    const user = setup();
    await seed({});
    await resume(user);
    await user.click(screen.getByText('Nee'));
    const dialog = neeDialog();
    const comment = within(dialog).getByRole('textbox', { name: 'Wat is er mis?' }) as HTMLTextAreaElement;
    expect(comment.maxLength).toBe(250);
    fireEvent.change(comment, { target: { value: '   ' } });
    pickToday(dialog);
    await user.click(button('Doorgaan', dialog));
    expect(within(dialog).getByText('Schrijf kort op wat er mis is.')).toBeTruthy();
    expect(within(dialog).queryByText(/tekens over/)).toBeNull();

    fireEvent.change(comment, { target: { value: 'x'.repeat(200) } });
    expect(within(dialog).getByText('Nog 50 tekens over.')).toBeTruthy();
  });

  test('after 9B comes "Wat gaat hier goed?"', async () => {
    const user = setup();
    await seed(allJaExcept('9B'));
    await resume(user);
    expect(screen.getByText(Q9B)).toBeTruthy();
    await user.click(screen.getByText('Ja'));
    await user.click(button('Volgende'));
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
    await user.click(button('Volgende'));
    expect(screen.getByRole('heading', { name: 'Klopt alles?' })).toBeTruthy();
  });

  test('a comment can be added before or after Ja, is saved, and shows in the summary', async () => {
    const user = setup();
    render(<App />);
    await fillStart(user);
    await user.click(await screen.findByRole('button', { name: 'Start inspectie' }));
    await settle();

    // Before answering: write the note, then answer.
    await user.click(button('Opmerking toevoegen'));
    const dialog = screen.getByRole('dialog', { name: 'Opmerking' });
    expect(within(dialog).getByText('Niet verplicht. Mag kort.')).toBeTruthy();
    await user.type(within(dialog).getByRole('textbox', { name: 'Opmerking' }), 'Ligt in de bus');
    await user.click(button('Klaar', dialog));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(Q1A)).toBeTruthy();
    expect(screen.getByText('Ligt in de bus')).toBeTruthy();
    await user.click(screen.getByText('Ja'));
    await user.click(button('Volgende'));
    expect(screen.getByText(Q1B)).toBeTruthy();

    // After answering: the note is added on the same question.
    await settle();
    await user.click(screen.getByText('Niet van toepassing'));
    await user.click(button('Opmerking toevoegen'));
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

  test('from the summary a Ja/Nvt comment can be changed on its question', async () => {
    const user = setup();
    const d = await seed(allJaExcept());
    await saveDraft({ ...d, notes: { '4A': 'Twee blussers bij de ingang' } });
    render(<App />);
    await screen.findByText('Je bent nog bezig met een inspectie');
    const state = { screen: { name: 'summary' } };
    act(() => {
      history.pushState(state, '');
      dispatchEvent(new PopStateEvent('popstate', { state }));
    });
    await user.click(screen.getByRole('button', { name: /^Brandpreventie/ }));
    expect(screen.getByText('Zijn er blusmiddelen, en kun je erbij?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Aanpassen/ }).textContent).toContain('Twee blussers bij de ingang');
  });

  test('the back arrow goes one question back, keeps the answer, and is not on the first question', async () => {
    const user = setup();
    render(<App />);
    await fillStart(user);
    await user.click(await screen.findByRole('button', { name: 'Start inspectie' }));
    expect(screen.queryByRole('button', { name: 'Vorige' })).toBeNull();
    await settle();
    await user.click(screen.getByText('Ja'));
    await user.click(button('Volgende'));
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

  test('back right after answering goes to the previous question and stays there', async () => {
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
    await user.click(screen.getByRole('button', { name: /^Brandpreventie/ }));
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
    expect(button('Foto toevoegen', dialog).disabled).toBe(true);
    expect(within(dialog).getByText("Maximaal 3 foto's per vraag.")).toBeTruthy();

    await user.click(within(dialog).getAllByRole('button', { name: 'Foto verwijderen' })[0]!);
    expect(within(dialog).getAllByRole('button', { name: 'Foto verwijderen' })).toHaveLength(2);
    expect(button('Foto toevoegen', dialog).disabled).toBe(false);
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
    expect(button('Foto toevoegen', dialog).disabled).toBe(true);
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
    expect(button('Foto toevoegen', dialog).disabled).toBe(false);
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
    expect(screen.getByText(Q1A)).toBeTruthy();
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
  test('the keyboard key goes to the next field; on the last one it starts once all is filled in', async () => {
    const user = setup();
    render(<App />);
    const naam = await screen.findByLabelText('Jouw naam');
    expect(naam.getAttribute('enterkeyhint')).toBe('next');
    // Says it is the technician's own name, and comes before the question about the place.
    expect(naam.getAttribute('placeholder')).toBe('Voor- en achternaam');
    const where = screen.getByText('Waar doe je vandaag de inspectie?');
    expect(naam.compareDocumentPosition(where) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.type(naam, 'J. Jansen{Enter}');
    expect(document.activeElement).toBe(screen.getByLabelText('Project'));
    await user.keyboard('Voorbeeld B.V.{Enter}');
    const nummer = screen.getByLabelText('Projectnummer');
    expect(document.activeElement).toBe(nummer);
    expect(nummer.getAttribute('enterkeyhint')).toBe('go');
    // The Start button rides above the keyboard.
    expect(button('Start inspectie').closest('footer')!.className).toContain('bottom-[var(--keyboard-inset,0px)]');
    await user.keyboard('P-1{Enter}');
    expect(screen.getByText(Q1A)).toBeTruthy();
  });

  test('shows the logo only when the server has one', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ hasLogo: true }) });
    const { container, unmount } = render(<App />);
    await waitFor(() => expect(container.querySelector('img[src="/api/branding/logo"]')).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledWith('/api/branding', expect.anything());
    unmount();

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const second = render(<App />);
    await screen.findByLabelText('Jouw naam');
    expect(screen.getByRole('heading', { name: 'Werkplekinspectie' })).toBeTruthy();
    expect(second.container.querySelector('img')).toBeNull();
  });

  test('a remembered name greets; Aanpassen shows the field; the name is saved on start', async () => {
    await setRememberedName('J. Jansen');
    const user = setup();
    render(<App />);
    expect(await screen.findByText('Hoi J. Jansen!')).toBeTruthy();
    expect(screen.queryByLabelText('Jouw naam')).toBeNull();
    await user.click(button('Naam aanpassen'));
    const naam = screen.getByLabelText('Jouw naam') as HTMLInputElement;
    expect(naam.value).toBe('J. Jansen');
    // Every text field stops at 250 characters.
    expect(naam.maxLength).toBe(250);
    expect((screen.getByLabelText('Project') as HTMLInputElement).maxLength).toBe(250);
    expect((screen.getByLabelText('Projectnummer') as HTMLInputElement).maxLength).toBe(250);
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
    await user.type(await screen.findByLabelText('Jouw naam'), '   ');
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
