import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from './cn';

export type SheetTone = 'default' | 'nee';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visible heading; also the dialog's accessible name. */
  title: ReactNode;
  /** 'nee' is the roze panel used after answering Nee. */
  tone?: SheetTone;
  children: ReactNode;
  className?: string;
}

/**
 * Bottom sheet on top of Radix Dialog: focus is trapped inside, Escape and a
 * tap on the dimmed backdrop close it, and the title names the dialog.
 */
export function Sheet({ open, onOpenChange, title, tone = 'default', children, className }: SheetProps) {
  const nee = tone === 'nee';
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
            'fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92dvh] w-full max-w-[480px] overflow-y-auto',
            'rounded-t-sheet px-[18px] pt-5 pb-[calc(22px+env(safe-area-inset-bottom))] text-ink outline-none',
            nee ? 'bg-roze' : 'bg-white',
            'motion-safe:data-[state=open]:animate-sheet-in motion-safe:data-[state=closed]:animate-sheet-out',
            className,
          )}
        >
          <Dialog.Title
            className={cn(
              'm-0 mb-3 flex items-center gap-2.5 text-[22px] font-black leading-tight',
              nee ? 'text-coral-d' : 'text-ink',
            )}
          >
            {nee && (
              <span aria-hidden="true" className="grid size-[34px] shrink-0 place-items-center rounded-full bg-coral text-white">
                <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </span>
            )}
            {title}
          </Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
