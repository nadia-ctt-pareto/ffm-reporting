'use client';

import { useMemo } from 'react';
import { PageHeader } from '@/components/app/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/Pagination';
import { Select } from '@/components/ui/Select';
import { StatCard } from '@/components/ui/StatCard';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { PAGE_SIZE_OPTIONS, STATUS_FILTER_OPTIONS } from '@/lib/constants';
import { buildAllTasksCsv, downloadCsv } from '@/lib/csv';
import { fmtDateShort } from '@/lib/format';
import { DELETE_REPORT_HINT } from '@/lib/report-access';
import { onSchedule, openBlockers, statusTone } from '@/lib/report-utils';
import type { DailyReport } from '@/lib/types';
import styles from './DailyListScreen.module.css';

export interface DailyListScreenProps {
  reports: DailyReport[];
  filterStatus: string;
  onFilterStatusChange: (value: string) => void;
  /** One of PAGE_SIZE_OPTIONS ('4' | '8' | '12' | 'All'). */
  pageSize: string;
  onPageSizeChange: (value: string) => void;
  page: number;
  onPageChange: (page: number) => void;
  onNewDaily: () => void;
  onResumeDraft: (id: string) => void;
  onViewReport: (id: string) => void;
  /** WP4: opens the shared delete-confirmation dialog (owned/hosted by `DailyPage`) for the report with this id -- see `DashboardScreen.tsx`'s identical prop doc comment. */
  onDeleteReport: (id: string) => void;
  /** WP4: per-row gate for the row's Delete button -- see `DashboardScreen.tsx`'s identical prop doc comment. */
  canDeleteReport: (report: DailyReport) => boolean;
}

const TABLE_COLUMNS: TableColumn[] = [
  { key: 'date', label: 'Date' },
  { key: 'status', label: 'Status' },
  { key: 'tasks', label: 'Tasks On Sched.', align: 'center' },
  { key: 'blockers', label: 'Blockers', align: 'center' },
  { key: 'updated', label: 'Updated' },
  { key: 'actions', label: '', align: 'right', isAction: true },
];

/**
 * `/daily` -- one row per daily report (newest first), mirroring
 * `components/dashboard/DashboardScreen.tsx`: stat cards, a Status filter,
 * pagination (page size 4/8/12/All), "New Daily Report", and a CSV export
 * of every daily's tasks (`buildAllTasksCsv`, shared with the weekly
 * dashboard's export -- see lib/csv.ts).
 */
export function DailyListScreen({
  reports,
  filterStatus,
  onFilterStatusChange,
  pageSize,
  onPageSizeChange,
  page,
  onPageChange,
  onNewDaily,
  onResumeDraft,
  onViewReport,
  onDeleteReport,
  canDeleteReport,
}: DailyListScreenProps) {
  const filtered = useMemo(() => {
    const list = reports.filter((r) => filterStatus === 'All' || r.status === filterStatus);
    return [...list].sort((a, b) => b.date.localeCompare(a.date));
  }, [reports, filterStatus]);

  const totalPages = pageSize === 'All' ? 1 : Math.max(1, Math.ceil(filtered.length / Number(pageSize)));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const paged =
    pageSize === 'All' ? filtered : filtered.slice((safePage - 1) * Number(pageSize), safePage * Number(pageSize));

  const tableRows = paged.map((r) => {
    const { onSched, total } = onSchedule(r);
    const blockers = openBlockers(r);
    const isDraft = r.status === 'Draft';
    const deletable = canDeleteReport(r);
    return {
      date: fmtDateShort(r.date),
      status: <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
      tasks: `${onSched} / ${total}`,
      blockers: String(blockers),
      updated: fmtDateShort(r.updatedAt),
      actions: (
        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.rowAction}
            onClick={() => (isDraft ? onResumeDraft(r.id) : onViewReport(r.id))}
          >
            {isDraft ? 'Continue' : 'View'}
          </button>
          {/* WP4: see DashboardScreen.tsx's identical row-Delete comment. */}
          <button
            type="button"
            className={styles.rowAction}
            onClick={() => onDeleteReport(r.id)}
            disabled={!deletable}
            title={!deletable ? DELETE_REPORT_HINT : undefined}
          >
            Delete
          </button>
        </div>
      ),
    };
  });

  const latest = [...reports].sort((a, b) => b.date.localeCompare(a.date))[0];

  const avgPct = reports.length
    ? Math.round(
        (reports.reduce((acc, r) => {
          const { onSched, total } = onSchedule(r);
          return acc + (total ? onSched / total : 0);
        }, 0) /
          reports.length) *
          100
      )
    : 0;

  const handleExportCsv = () => {
    const csv = buildAllTasksCsv(reports);
    downloadCsv('daily-reports-tasks.csv', csv);
  };

  return (
    <div>
      <PageHeader
        title="Daily Reports"
        actions={
          <>
            <Button variant="outline" size="md" onClick={handleExportCsv}>
              Export All Tasks (CSV)
            </Button>
            <Button variant="primary" size="md" onClick={onNewDaily}>
              New Daily Report
            </Button>
          </>
        }
      />

      <div className={styles.content}>
        <div className={styles.statsGrid}>
          <StatCard label="Total Daily Reports" value={String(reports.length)} />
          <StatCard label="Avg. Tasks On Schedule" value={`${avgPct}%`} />
          <StatCard label="Open Blockers (Latest)" value={latest ? String(openBlockers(latest)) : '0'} />
        </div>

        <div className={styles.filterBar}>
          <div className={styles.fieldStatus}>
            <Select label="Status" options={[...STATUS_FILTER_OPTIONS]} value={filterStatus} onChange={onFilterStatusChange} />
          </div>
          <div className={styles.fieldPageSize}>
            <Select label="Per Page" options={[...PAGE_SIZE_OPTIONS]} value={pageSize} onChange={onPageSizeChange} />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className={styles.emptyState}>No daily reports match these filters.</div>
        ) : (
          <>
            <Table columns={TABLE_COLUMNS} rows={tableRows} stacked />
            {pageSize !== 'All' ? <Pagination page={safePage} totalPages={totalPages} onPageChange={onPageChange} /> : null}
          </>
        )}
      </div>
    </div>
  );
}
