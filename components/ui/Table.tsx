import type { ReactNode } from 'react';
import styles from './Table.module.css';

export interface TableColumn {
  key: string;
  label: string;
  align?: 'center' | 'right';
  /**
   * Mobile P3 follow-up: marks this column as a row-action column (e.g. a
   * "View" link) for `stacked` layout -- it renders right-aligned with no
   * generated label, via `data-role="actions"` (Table.module.css). This is
   * a separate concept from `label: ''`: a column can have an empty label
   * for other reasons (e.g. a self-labeling checkbox) without wanting the
   * action treatment. Ignored when `stacked` is false.
   */
  isAction?: boolean;
  /**
   * Mobile P3 follow-up: overrides `label` for the `data-label` used in
   * `stacked` layout only -- lets a column keep an intentionally empty
   * desktop `<th>` (e.g. a self-labeling checkbox column, where a visible
   * "Include" header would be redundant/unwanted at desktop) while still
   * showing a real label once it stacks into a mobile card. Falls back to
   * `label` when omitted; ignored when `stacked` is false.
   */
  stackedLabel?: string;
}

export interface TableProps {
  columns: TableColumn[];
  rows: Record<string, ReactNode>[];
  dense?: boolean;
  /**
   * Mobile P3: opt-in. At <=767px, collapses each row into a bordered card
   * (header hidden, every cell shows its column label via `data-label`,
   * see Table.module.css). Deliberately opt-in and OFF by default so
   * `ReportDeck.tsx`'s `<Table>` call sites (which pass neither this nor
   * `scrollX`) keep rendering their exact pre-P3 DOM/CSS -- load-bearing
   * for the printed slide deck (see CLAUDE.md "Report screen &
   * presentation deck").
   */
  stacked?: boolean;
  /**
   * Mobile P3: opt-in. Wraps the table in a horizontally-scrolling
   * container instead of stacking -- for desktop-leaning tables (e.g. the
   * Consolidate merge log) where card-stacking would add noise to a
   * secondary/audit flow.
   */
  scrollX?: boolean;
}

function alignClass(align: TableColumn['align']): string {
  if (align === 'center') return styles.alignCenter;
  if (align === 'right') return styles.alignRight;
  return '';
}

export function Table({ columns, rows, dense = false, stacked = false, scrollX = false }: TableProps) {
  const table = (
    <table
      role="table"
      className={`${styles.table} ${dense ? styles.dense : ''} ${stacked ? styles.stacked : ''} ${scrollX ? styles.scrollTable : ''}`}
    >
      <thead role="rowgroup">
        <tr role="row">
          {columns.map((col) => (
            <th key={col.key} role="columnheader" className={`${styles.th} ${alignClass(col.align)}`}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row, i) => (
          <tr key={i} role="row" className={styles.tr}>
            {columns.map((col) => (
              <td
                key={col.key}
                role="cell"
                className={`${styles.td} ${alignClass(col.align)}`}
                {...(stacked ? { 'data-label': col.stackedLabel ?? col.label, ...(col.isAction ? { 'data-role': 'actions' } : {}) } : {})}
              >
                {row[col.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return scrollX ? <div className={styles.scrollWrap}>{table}</div> : table;
}
