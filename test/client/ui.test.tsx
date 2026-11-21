import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { AnswerGroup, type Answer } from '../../src/client/ui/AnswerGroup';
import { ChunkyButton } from '../../src/client/ui/ChunkyButton';
import { DatePicker } from '../../src/client/ui/DatePicker';
import { ProgressBar } from '../../src/client/ui/ProgressBar';
import { Sheet } from '../../src/client/ui/Sheet';
import { useKeyboardInset } from '../../src/client/ui/useKeyboardInset';

function radio(name: string): HTMLInputElement {
  return screen.getByRole('radio', { name }) as HTMLInputElement;
}

/** Tailwind 4: a bare `outline-none` also kills the focus-visible ring, so require outline-solid. */
function expectFocusRing(el: Element, variant: 'focus-visible' | 'has-focus-visible') {
  const classes = el.className.split(/\s+/);
  expect(classes).not.toContain('outline-none');
  expect(classes).toContain(`${variant}:outline-solid`);
  expect(classes).toContain(`${variant}:outline-3`);
}

function ControlledGroup({ onChange }: { onChange: (v: Answer) => void }) {
  const [value, setValue] = useState<Answer | undefined>(undefined);
  return (
    <AnswerGroup
      name="4B"
      legend="Zijn de blusmiddelen gekeurd?"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe('AnswerGroup', () => {
  test('renders three radios named Ja, Nee, Niet van toepassing in a named fieldset', () => {
    render(<AnswerGroup name="1A" legend="Heb je het VGM-handboekje bij je?" value={undefined} onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'Heb je het VGM-handboekje bij je?' });
    expect(group.tagName).toBe('FIELDSET');
    expect(screen.getAllByRole('radio')).toEqual([radio('Ja'), radio('Nee'), radio('Niet van toepassing')]);
    expect(new Set(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).name))).toEqual(new Set(['1A']));
  });

  test('clicking Nee calls onChange("nee")', async () => {
    const onChange = vi.fn();
    render(<AnswerGroup name="1A" legend="Vraag" value={undefined} onChange={onChange} />);
    await userEvent.click(screen.getByText('Nee'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('nee');
  });

  test('reflects the controlled value as the checked radio', () => {
    render(<AnswerGroup name="1A" legend="Vraag" value="nvt" onChange={() => {}} />);
    expect(radio('Niet van toepassing').checked).toBe(true);
    expect(radio('Ja').checked).toBe(false);
    expect(radio('Nee').checked).toBe(false);
  });

  test('every option label shows a keyboard focus ring', () => {
    render(<AnswerGroup name="1A" legend="Vraag" value="ja" onChange={() => {}} />);
    for (const r of screen.getAllByRole('radio')) expectFocusRing(r.closest('label')!, 'has-focus-visible');
  });

  test('arrow keys move the selection (native radio behaviour)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ControlledGroup onChange={onChange} />);
    await user.click(radio('Ja'));
    expect(onChange).toHaveBeenLastCalledWith('ja');
    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith('nee');
    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith('nvt');
    expect(radio('Niet van toepassing').checked).toBe(true);
    expect(document.activeElement).toBe(radio('Niet van toepassing'));
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith('nee');
    expect(radio('Nee').checked).toBe(true);
  });
});

describe('ChunkyButton', () => {
  test('busy is disabled, has aria-busy and does not fire onClick', async () => {
    const onClick = vi.fn();
    render(
      <ChunkyButton busy onClick={onClick}>
        Verstuur inspectie
      </ChunkyButton>,
    );
    const button = screen.getByRole('button', { name: 'Verstuur inspectie' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  test('defaults to type="button" and fires onClick', async () => {
    const onClick = vi.fn();
    render(<ChunkyButton onClick={onClick}>Volgende</ChunkyButton>);
    const button = screen.getByRole('button', { name: 'Volgende' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('aria-busy')).toBe(false);
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('ChunkyButton focus ring', () => {
  test.each(['main', 'coral', 'line', 'ghost'] as const)('%s shows a focus-visible ring', (variant) => {
    render(<ChunkyButton variant={variant}>Volgende</ChunkyButton>);
    expectFocusRing(screen.getByRole('button'), 'focus-visible');
  });
});

describe('ProgressBar', () => {
  test('exposes aria-valuenow as a 0-100 integer and the label', () => {
    render(<ProgressBar value={12 / 21} label="Vraag 12 van 21" />);
    const bar = screen.getByRole('progressbar', { name: 'Vraag 12 van 21' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('57');
    expect(bar.getAttribute('aria-valuetext')).toBe('Vraag 12 van 21');
  });

  test('clamps values outside 0..1', () => {
    render(<ProgressBar value={1.4} label="Klaar" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
});

describe('Sheet', () => {
  test('is a titled, focus-holding dialog that closes on Escape', async () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange} title="Wat is er mis?" tone="nee">
        <button type="button">Doorgaan</button>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Wat is er mis?' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test('Tab and Shift+Tab keep focus inside the dialog', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Buiten</button>
        <Sheet open onOpenChange={() => {}} title="Wat is er mis?">
          <button type="button">Foto</button>
          <button type="button">Doorgaan</button>
        </Sheet>
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Wat is er mis?' });
    const first = screen.getByRole('button', { name: 'Foto' });
    const last = screen.getByRole('button', { name: 'Doorgaan' });
    expect(document.activeElement).toBe(first);
    await user.tab();
    expect(document.activeElement).toBe(last);
    await user.tab();
    expect(document.activeElement).toBe(first);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  test('renders nothing when closed', () => {
    render(
      <Sheet open={false} onOpenChange={() => {}} title="Wat is er mis?">
        <p>Inhoud</p>
      </Sheet>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('useKeyboardInset', () => {
  /** A stand-in for window.visualViewport, which jsdom does not have. */
  function fakeViewport(init: { height: number; offsetTop?: number; scale?: number }) {
    const vv = Object.assign(new EventTarget(), { offsetTop: 0, scale: 1, ...init });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    return vv;
  }

  function Probe() {
    useKeyboardInset();
    return null;
  }

  const cssVar = (name: string) => document.documentElement.style.getPropertyValue(name);

  test('measures how much the keyboard covers, and the visible height', async () => {
    vi.stubGlobal('innerHeight', 800);
    const vv = fakeViewport({ height: 800 });
    const { unmount } = render(<Probe />);
    expect(cssVar('--keyboard-inset')).toBe('0px');
    expect(cssVar('--visual-height')).toBe('800px');

    // iOS: the keyboard shrinks the visual viewport; Safari also scrolls it a bit.
    Object.assign(vv, { height: 440, offsetTop: 60 });
    await act(async () => {
      vv.dispatchEvent(new Event('resize'));
      await new Promise((r) => requestAnimationFrame(r));
    });
    expect(cssVar('--keyboard-inset')).toBe('300px');
    expect(cssVar('--visual-height')).toBe('440px');

    unmount();
    expect(cssVar('--keyboard-inset')).toBe('');
    vi.unstubAllGlobals();
  });

  test('pinch zoom is not a keyboard', () => {
    vi.stubGlobal('innerHeight', 800);
    fakeViewport({ height: 400, scale: 2 });
    render(<Probe />);
    expect(cssVar('--keyboard-inset')).toBe('0px');
    vi.unstubAllGlobals();
  });
});

describe('Sheet above the keyboard', () => {
  test('sits on the keyboard inset and is never taller than the visible height', () => {
    render(
      <Sheet open onOpenChange={() => undefined} title="Test">
        <p>inhoud</p>
      </Sheet>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Test' });
    expect(dialog.className).toContain('bottom-[var(--keyboard-inset,0px)]');
    expect(dialog.className).toContain('var(--visual-height,100dvh)');
  });
});

describe('DatePicker', () => {
  // Friday 20 November 2026.
  const TODAY = '2026-11-20';

  function Picker({ initial = '', min = TODAY, today = TODAY }: { initial?: string; min?: string; today?: string }) {
    const [value, setValue] = useState(initial);
    return (
      <>
        <DatePicker legend="Opgelost vóór" value={value} min={min} today={today} onChange={setValue} />
        <output>{value}</output>
      </>
    );
  }
  const picked = () => document.querySelector('output')!.textContent;
  const day = (date: string) => document.querySelector<HTMLButtonElement>(`[data-date="${date}"]`)!;

  test('only a Monday-first month calendar, named by the legend; picking a day sets it', async () => {
    const user = userEvent.setup();
    render(<Picker />);
    expect(screen.getByRole('group', { name: 'Opgelost vóór' })).toBeTruthy();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    const grid = screen.getByRole('grid', { name: 'november 2026' });
    expect([...grid.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']);
    // 1 November 2026 is a Sunday: six empty cells before it.
    expect(grid.querySelector('tbody tr')!.querySelectorAll('td button')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'donderdag 26 november 2026' }));
    expect(picked()).toBe('2026-11-26');
    expect(day('2026-11-26').closest('td')!.getAttribute('aria-selected')).toBe('true');
  });

  test('today is marked with a darker background, and can be chosen', async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const today = screen.getByRole('button', { name: 'vrijdag 20 november 2026, vandaag' });
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(today.className).toContain('bg-grey');
    await user.click(today);
    expect(picked()).toBe(TODAY);
    expect(today.className).toContain('bg-brand');
  });

  test('every day before today is greyed out and cannot be chosen, even if the inspection began earlier', async () => {
    const user = userEvent.setup();
    render(<Picker min="2026-11-18" />);
    for (const date of ['2026-11-01', '2026-11-18', '2026-11-19']) {
      expect(day(date).getAttribute('aria-disabled')).toBe('true');
      expect(day(date).className).toContain('text-mute');
      await user.click(day(date));
    }
    expect(picked()).toBe('');
    expect(day('2026-11-21').hasAttribute('aria-disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Vorige maand' })).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('button', { name: 'Volgende maand' }));
    expect(screen.getByRole('grid', { name: 'december 2026' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Vorige maand' }));
    expect(screen.getByRole('grid', { name: 'november 2026' })).toBeTruthy();
  });

  test('keyboard: arrows, Home/End and PageUp/PageDown move one roving focus; Enter picks', async () => {
    const user = userEvent.setup();
    render(<Picker />);
    // Exactly one day is in the Tab order: today, when nothing is chosen yet.
    expect([...document.querySelectorAll('[data-date][tabindex="0"]')].map((b) => b.getAttribute('data-date'))).toEqual([TODAY]);
    act(() => day(TODAY).focus());
    const at = () => document.activeElement!.getAttribute('data-date');
    await user.keyboard('{ArrowRight}');
    expect(at()).toBe('2026-11-21');
    await user.keyboard('{ArrowDown}');
    expect(at()).toBe('2026-11-28');
    await user.keyboard('{Home}');
    expect(at()).toBe('2026-11-23');
    await user.keyboard('{End}');
    expect(at()).toBe('2026-11-29');
    await user.keyboard('{ArrowDown}');
    expect(at()).toBe('2026-12-06');
    expect(screen.getByRole('grid', { name: 'december 2026' })).toBeTruthy();
    await user.keyboard('{PageUp}{PageUp}');
    // Never before today.
    expect(at()).toBe(TODAY);
    await user.keyboard('{ArrowLeft}');
    expect(at()).toBe(TODAY);
    await user.keyboard('{PageDown}{Enter}');
    expect(picked()).toBe('2026-12-20');
    expect(document.querySelectorAll('[data-date][tabindex="0"]')).toHaveLength(1);
  });

  test('opens on the month of a date chosen earlier', () => {
    render(<Picker initial="2027-01-15" />);
    expect(screen.getByRole('grid', { name: 'januari 2027' })).toBeTruthy();
    expect(day('2027-01-15').closest('td')!.getAttribute('aria-selected')).toBe('true');
  });
});
