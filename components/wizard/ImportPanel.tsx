'use client';

import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Select } from '@/components/ui/Select';
import styles from './ImportPanel.module.css';

export interface ImportCandidateProps {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
}

export interface ImportPanelProps {
  kicker: string;
  emptyMessage: string;
  sourceOptions: { value: string; label: string }[];
  sourceId: string;
  onSourceChange: (value: string) => void;
  candidates: ImportCandidateProps[];
  onImport: () => void;
  disabled: boolean;
}

/**
 * Generic "import pending items from a prior report" panel, shared by the
 * Task Status / Risks & Blockers / Priorities steps. Ported from
 * design-source lines 142-156 / 203-217 / 238-252 (identical shape, only the
 * kicker/empty-message copy and candidate source differ). The old
 * importPanelStyle/kickerStyle darkMode branches (lines 726-727) are gone --
 * the panel is now a plain token-driven class that flips with the theme.
 */
export function ImportPanel({
  kicker,
  emptyMessage,
  sourceOptions,
  sourceId,
  onSourceChange,
  candidates,
  onImport,
  disabled,
}: ImportPanelProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.kicker}>{kicker}</div>
      <div className={styles.sourceSelect}>
        <Select label="Source Report" options={sourceOptions} value={sourceId} onChange={onSourceChange} />
      </div>
      {candidates.length > 0 ? (
        <>
          <div className={styles.candidateList}>
            {candidates.map((c) => (
              <Checkbox key={c.id} label={c.label} checked={c.checked} onChange={c.onToggle} />
            ))}
          </div>
          <Button variant="outline" size="sm" disabled={disabled} onClick={onImport}>
            Import Selected
          </Button>
        </>
      ) : (
        <div className={styles.emptyMessage}>{emptyMessage}</div>
      )}
    </div>
  );
}
