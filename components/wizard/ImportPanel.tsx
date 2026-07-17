'use client';

import type { ChangeEvent } from 'react';
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
  darkMode: boolean;
}

/**
 * Generic "import pending items from a prior report" panel, shared by the
 * Task Status / Risks & Blockers / Priorities steps. Ported from
 * design-source lines 142-156 / 203-217 / 238-252 (identical shape, only the
 * kicker/empty-message copy and candidate source differ) and importPanelStyle
 * / kickerStyle (lines 726-727).
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
  darkMode,
}: ImportPanelProps) {
  const panelStyle = darkMode
    ? { background: '#141414', border: 'none', padding: '20px 22px', marginBottom: '28px', color: '#CFCFC9' }
    : { background: '#F7F7F5', border: '1px solid #E4E4DE', padding: '20px 22px', marginBottom: '28px', color: '#3A3A36' };
  const kickerColor = { color: darkMode ? '#9BA394' : '#283625' };

  return (
    <div style={panelStyle}>
      <div className={styles.kicker} style={kickerColor}>
        {kicker}
      </div>
      <div className={styles.sourceSelect}>
        <Select
          label="Source Report"
          options={sourceOptions}
          value={sourceId}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => onSourceChange(e.target.value)}
        />
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
