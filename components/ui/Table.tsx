import type { ReactNode } from 'react';
import styles from './Table.module.css';

export interface TableColumn {
  key: string;
  label: string;
  align?: 'center' | 'right';
}

export interface TableProps {
  columns: TableColumn[];
  rows: Record<string, ReactNode>[];
  dense?: boolean;
}

export function Table({ columns, rows, dense = false }: TableProps) {
  return (
    <table className={`${styles.table} ${dense ? styles.dense : ''}`}>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} className={styles.th} style={{ textAlign: col.align ?? 'left' }}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className={styles.tr}>
            {columns.map((col) => (
              <td key={col.key} className={styles.td} style={{ textAlign: col.align ?? 'left' }}>
                {row[col.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
