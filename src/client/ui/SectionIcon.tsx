import type { ReactNode } from 'react';
import type { SectionIconName } from '@shared/questions';
import { cn } from './cn';

// Simple 24×24 line icons, one per form section.
const PATHS: Record<SectionIconName, ReactNode> = {
  // Book
  instructie: (
    <>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      <path d="M9 7h6" />
    </>
  ),
  // Building
  werkomgeving: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V8l7-5 7 5v13" />
      <path d="M9.5 21v-6h5v6" />
    </>
  ),
  // Wrench
  gereedschap: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z" />
  ),
  // Flame
  brand: <path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.8 2.5-5 .3 1.6 1 2.5 2 3 .2-3-.5-5.5.5-8z" />,
  // Hard hat
  pbm: (
    <>
      <path d="M3 18h18" />
      <path d="M5 18v-3a7 7 0 0 1 14 0v3" />
      <path d="M10 9V6h4v3" />
    </>
  ),
  // Clipboard with tasks
  werk: (
    <>
      <rect x="5" y="4" width="14" height="18" rx="2" />
      <path d="M9 2h6v4H9z" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
  // Water drop
  hygiene: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  // Leaf
  milieu: (
    <>
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z" />
      <path d="M2 21c0-3 1.9-5.4 5.1-6C9.5 14.5 12 13 13 12" />
    </>
  ),
  // First-aid cross
  ehbo: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
};

export interface SectionIconProps {
  name: SectionIconName;
  className?: string;
}

/** Decorative: the section title next to it carries the meaning. */
export function SectionIcon({ name, className }: SectionIconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={cn('size-[22px] shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
