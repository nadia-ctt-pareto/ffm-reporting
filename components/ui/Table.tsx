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
  /**
   * `/tasks` task CRUD follow-up: opt-in per-row click activation, called
   * with the row's index into `rows` (the caller maps that back to whatever
   * domain object built that row -- e.g. `TaskList.tsx` indexes its own
   * `entries` array, which is built in the exact same order as `rows`).
   * When set, each `<tr>` gains `tabIndex={0}` and an Enter/Space
   * `onKeyDown` in addition to a plain `onClick` -- satisfying
   * "keyboard-activatable, not a bare onClick" without requiring a `<button>`
   * to illegally wrap `<td>` elements, and WITHOUT changing the row's ARIA
   * role (see the `role="row"` comment on the element itself for why
   * re-roling it as a button is invalid here). A nested interactive element inside a
   * clickable row (e.g. TaskList's "View Report" link) MUST call
   * `stopPropagation()` in its own `onClick`, or activating IT would also
   * fire this row's `onRowClick` (click events bubble regardless of target).
   * Keyboard is unaffected by this without any extra work: the row's own
   * `onKeyDown` only acts when `e.target === e.currentTarget` (i.e. the KEY
   * PRESS happened on the row itself, not a bubbled-up press from a focused
   * child), so Enter on a focused nested link still just activates that
   * link's own native behavior. Strictly opt-in (default `undefined`) so
   * every existing `Table` consumer (dashboard, daily list, `ReportDeck`,
   * Consolidate's source tables, ...) renders byte-identical DOM/CSS --
   * matching this component's established "additive-only" contract (see
   * `stacked`/`scrollX` above).
   */
  onRowClick?: (index: number) => void;
}

function alignClass(align: TableColumn['align']): string {
  if (align === 'center') return styles.alignCenter;
  if (align === 'right') return styles.alignRight;
  return '';
}

export function Table({ columns, rows, dense = false, stacked = false, scrollX = false, onRowClick }: TableProps) {
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
          <tr
            key={i}
            /* Stays `row` even when clickable. An earlier revision set
               `role="button"` here, which is INVALID ARIA: this `<tr>` is a
               child of `<tbody role="rowgroup">`, and a rowgroup's children
               must be rows -- re-roling it as a button removes the row from
               the table's accessibility tree entirely, so a screen-reader
               user loses row/column context for the whole table (and the
               table reports a malformed structure). Focusability plus the
               Enter/Space handler below is what makes the row activatable;
               that needs no role change, and keeping `row` preserves table
               navigation. */
            role="row"
            tabIndex={onRowClick ? 0 : undefined}
            /* Concatenated conditionally rather than with a template literal
               so a non-clickable row's className is exactly `styles.tr` with
               no trailing space -- this component's contract is that every
               existing consumer (notably `ReportDeck`, whose DOM the 6-page
               print contract depends on) renders byte-identical output. */
            className={onRowClick ? `${styles.tr} ${styles.trClickable}` : styles.tr}
            onClick={onRowClick ? () => onRowClick(i) : undefined}
            onKeyDown={
              onRowClick
                ? (e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRowClick(i);
                    }
                  }
                : undefined
            }
          >
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
