import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visible heading; also the dialog's accessible name. */
  title: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Bottom sheet on top of Radix Dialog: focus is trapped inside, Escape and a
 * tap on the dimmed backdrop close it, and the title names the dialog.
 */
export function Sheet({ open, onOpenChange, title, children, className }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-40 bg-ink/35',
            'motion-safe:data-[state=open]:animate-fade-in motion-safe:data-[state=closed]:animate-fade-out',
          )}
        />
        <Dialog.Content
          // No separate description: the content itself explains what to do.
          aria-describedby={undefined}
          className={cn(
            // Above the keyboard on iOS too (useKeyboardInset), and never taller than what is visible.
            'fixed inset-x-0 bottom-[var(--keyboard-inset,0px)] z-50 mx-auto w-full max-w-[480px] overflow-y-auto',
            'max-h-[min(92dvh,calc(var(--visual-height,100dvh)-24px))]',
            'rounded-t-sheet px-[18px] pt-5 pb-[calc(22px+env(safe-area-inset-bottom))] text-ink outline-none',
            'bg-white',
            'motion-safe:data-[state=open]:animate-sheet-in motion-safe:data-[state=closed]:animate-sheet-out',
            // Tablet and desktop: a dialog in the middle of what is visible above the keyboard.
            'md:top-0 md:my-auto md:h-fit md:max-w-[520px] md:rounded-sheet md:pb-6 md:shadow-[0_24px_60px_-12px_rgb(38_25_60/0.35)]',
            'md:max-h-[min(calc(100dvh-4rem),calc(var(--visual-height,100dvh)-4rem))]',
            'md:motion-safe:data-[state=open]:animate-dialog-in md:motion-safe:data-[state=closed]:animate-dialog-out',
            className,
          )}
        >
          <Dialog.Title className="m-0 mb-3 text-[22px] font-black leading-tight text-ink">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
