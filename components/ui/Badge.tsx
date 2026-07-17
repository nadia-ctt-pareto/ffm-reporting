import type { ReactNode } from 'react';
import type { BadgeTone } from '@/lib/types';
import styles from './Badge.module.css';

export interface BadgeProps {
  tone: BadgeTone;
  children: ReactNode;
}

const KNOWN_TONES: BadgeTone[] = ['positive', 'negative', 'warning', 'sage', 'dark', 'neutral'];

export function Badge({ tone, children }: BadgeProps) {
  // Faithful port of ffBadgeStyle(tone) (design-source lines 430-440): any
  // tone not in the style map -- e.g. 'green', which statusTone() returns
  // for 'Final' reports -- falls back to 'neutral'. See the BadgeTone doc
  // comment in lib/types.ts.
  const resolvedTone = KNOWN_TONES.includes(tone) ? tone : 'neutral';
  return <span className={`${styles.badge} ${styles[resolvedTone]}`}>{children}</span>;
}
