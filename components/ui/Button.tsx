import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

/**
 * Restrained-colour pass: `danger` (destructive actions -- delete a report/
 * project, confirm a delete dialog) and `accent` (confirming/constructive
 * actions -- "Add …" row buttons) join the original four. Both follow the
 * existing `outline`/`dark` posture of "quiet by default, solid fill on
 * hover/active" rather than shouting at rest -- see Button.module.css's own
 * comment on each for the measured dark-mode contrast this relies on.
 * Colour is intent-only: every other button in this app stays one of the
 * original four, on purpose (see CLAUDE.md's "Restrained" colour strategy).
 */
export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'dark' | 'danger' | 'dangerSolid' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Optional leading icon (e.g. `IconTrash`/`IconPlus`/`IconCheck`,
   * components/ui/icons.tsx), rendered before `children` inside its own
   * `flex: none` slot so a long label can never squeeze it. Every icon in
   * that file is already `aria-hidden` -- this button's accessible name
   * still comes from `children`/an explicit `aria-label`, never the glyph.
   * `icon`-only usage (no visible `children`) MUST pass its own
   * `aria-label` via `...rest`, same as any other icon-only control in this
   * app (see components/ai/PolishTrigger.tsx).
   */
  icon?: ReactNode;
  children: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', type = 'button', icon, children, ...rest }: ButtonProps) {
  const classes = [styles.button, styles[variant], styles[size]].join(' ');
  return (
    <button type={type} className={classes} {...rest}>
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      {children}
    </button>
  );
}
