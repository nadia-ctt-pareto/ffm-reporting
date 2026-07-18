'use client';

import type { ChangeEvent } from 'react';
import { useMemo } from 'react';
import { PageHeader } from '@/components/app/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Select } from '@/components/ui/Select';
import { StatCard } from '@/components/ui/StatCard';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { CLIENT_FILTER_OPTIONS, FF_CLIENTS, PAGE_SIZE_OPTIONS, SORT_OPTIONS, STATUS_FILTER_OPTIONS } from '@/lib/constants';
import { buildAllTasksCsv, downloadCsv } from '@/lib/csv';
import { fmtDateShort, fmtWeekLabel } from '@/lib/format';
import { onSchedule, openBlockers, statusTone } from '@/lib/report-utils';
import type { Report, SortKey } from '@/lib/types';
import styles from './DashboardScreen.module.css';

export interface DashboardScreenProps {
  reports: Report[];
  filterStatus: string;
  onFilterStatusChange: (value: string) => void;
  filterClient: string;
  onFilterClientChange: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  sortBy: SortKey;
  onSortByChange: (value: SortKey) => void;
  /** One of PAGE_SIZE_OPTIONS ('4' | '8' | '12' | 'All'). */
  pageSize: string;
  onPageSizeChange: (value: string) => void;
  page: number;
  onPageChange: (page: number) => void;
  onNewReport: () => void;
  onResumeDraft: (id: string) => void;
  onViewReport: (id: string) => void;
}

const TABLE_COLUMNS: TableColumn[] = [
  { key: 'week', label: 'Week' },
  { key: 'preparedFor', label: 'Prepared For' },
  { key: 'status', label: 'Status' },
  { key: 'tasks', label: 'Tasks On Sched.', align: 'center' },
  { key: 'blockers', label: 'Blockers', align: 'center' },
  { key: 'updated', label: 'Updated' },
  { key: 'actions', label: '', align: 'right' },
];

export function DashboardScreen({
  reports,
  filterStatus,
  onFilterStatusChange,
  filterClient,
  onFilterClientChange,
  search,
  onSearchChange,
  sortBy,
  onSortByChange,
  pageSize,
  onPageSizeChange,
  page,
  onPageChange,
  onNewReport,
  onResumeDraft,
  onViewReport,
}: DashboardScreenProps) {
  // Lines 650-660: filter + sort.
  const filtered = useMemo(() => {
    const list = reports.filter(
      (r) =>
        (filterStatus === 'All' || r.status === filterStatus) &&
        (filterClient === 'All' || r.tasks.some((t) => t.client === filterClient)) &&
        (search.trim() === '' ||
          (r.preparedFor + ' ' + fmtWeekLabel(r.weekStart, r.weekEnd)).toLowerCase().includes(search.toLowerCase()))
    );
    return [...list].sort((a, b) => {
      if (sortBy === 'week_asc') return a.weekEnd.localeCompare(b.weekEnd);
      if (sortBy === 'status') return a.status.localeCompare(b.status);
      if (sortBy === 'blockers_desc') return openBlockers(b) - openBlockers(a);
      return b.weekEnd.localeCompare(a.weekEnd);
    });
  }, [reports, filterStatus, filterClient, search, sortBy]);

  // Pagination: slice AFTER filter + sort. 'All' disables paging entirely.
  const totalPages = pageSize === 'All' ? 1 : Math.max(1, Math.ceil(filtered.length / Number(pageSize)));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const paged =
    pageSize === 'All' ? filtered : filtered.slice((safePage - 1) * Number(pageSize), safePage * Number(pageSize));

  // Lines 661-676: table rows, including the status badge and the
  // Continue(draft)/View(else) action button.
  const tableRows = paged.map((r) => {
    const { onSched, total } = onSchedule(r);
    const blockers = openBlockers(r);
    const isDraft = r.status === 'Draft';
    return {
      week: fmtWeekLabel(r.weekStart, r.weekEnd),
      preparedFor: r.preparedFor,
      status: <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
      tasks: `${onSched} / ${total}`,
      blockers: String(blockers),
      updated: fmtDateShort(r.updatedAt),
      actions: (
        <button
          type="button"
          className={styles.rowAction}
          onClick={() => (isDraft ? onResumeDraft(r.id) : onViewReport(r.id))}
        >
          {isDraft ? 'Continue' : 'View'}
        </button>
      ),
    };
  });

  // Line 677: latest report by weekEnd.
  const latest = [...reports].sort((a, b) => b.weekEnd.localeCompare(a.weekEnd))[0];

  // Line 678: rounded mean of per-report onSched/total ratios.
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
    downloadCsv('weekly-reports-tasks.csv', csv);
  };

  return (
    <div>
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <Button variant="outline" size="md" onClick={handleExportCsv}>
              Export All Tasks (CSV)
            </Button>
            <Button variant="primary" size="md" onClick={onNewReport}>
              New Report
            </Button>
          </>
        }
      />

      <div className={styles.content}>
        <div className={styles.statsGrid}>
          <StatCard label="Total Reports" value={String(reports.length)} />
          <StatCard label="Avg. Tasks On Schedule" value={`${avgPct}%`} />
          <StatCard label="Open Blockers (Latest)" value={latest ? String(openBlockers(latest)) : '0'} />
          <StatCard label="Active Clients" value={String(FF_CLIENTS.length)} />
        </div>

        <div className={styles.filterBar}>
          <div style={{ width: 170 }}>
            <Select label="Status" options={[...STATUS_FILTER_OPTIONS]} value={filterStatus} onChange={onFilterStatusChange} />
          </div>
          <div style={{ width: 280 }}>
            <Select label="Client" options={[...CLIENT_FILTER_OPTIONS]} value={filterClient} onChange={onFilterClientChange} />
          </div>
          <div style={{ width: 260 }}>
            <Input
              label="Search"
              placeholder="Week or contact"
              value={search}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value)}
            />
          </div>
          <div style={{ width: 260 }}>
            <Select
              label="Sort By"
              options={SORT_OPTIONS}
              value={sortBy}
              onChange={(value) => onSortByChange(value as SortKey)}
            />
          </div>
          <div style={{ width: 110 }}>
            <Select label="Per Page" options={[...PAGE_SIZE_OPTIONS]} value={pageSize} onChange={onPageSizeChange} />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className={styles.emptyState}>No reports match these filters.</div>
        ) : (
          <>
            <Table columns={TABLE_COLUMNS} rows={tableRows} />
            {pageSize !== 'All' ? <Pagination page={safePage} totalPages={totalPages} onPageChange={onPageChange} /> : null}
          </>
        )}
      </div>
    </div>
  );
}
