import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { AnswerGroup, type Answer } from '../../src/client/ui/AnswerGroup';
import { ChunkyButton } from '../../src/client/ui/ChunkyButton';
import { ProgressBar } from '../../src/client/ui/ProgressBar';
import { Sheet } from '../../src/client/ui/Sheet';

function radio(name: string): HTMLInputElement {
  return screen.getByRole('radio', { name }) as HTMLInputElement;
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

describe('ProgressBar', () => {
  test('exposes aria-valuenow as a 0-100 integer and the label', () => {
    render(<ProgressBar value={12 / 21} label="Vraag 12 van 21" />);
    const bar = screen.getByRole('progressbar', { name: 'Vraag 12 van 21' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('57');
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

  test('renders nothing when closed', () => {
    render(
      <Sheet open={false} onOpenChange={() => {}} title="Wat is er mis?">
        <p>Inhoud</p>
      </Sheet>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
