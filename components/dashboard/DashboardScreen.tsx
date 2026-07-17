'use client';

import type { ChangeEvent, CSSProperties } from 'react';
import { useMemo } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { StatCard } from '@/components/ui/StatCard';
import { Switch } from '@/components/ui/Switch';
import { Table } from '@/components/ui/Table';
import type { TableColumn } from '@/components/ui/Table';
import { CLIENT_FILTER_OPTIONS, FF_CLIENTS, SORT_OPTIONS, STATUS_FILTER_OPTIONS } from '@/lib/constants';
import { buildAllTasksCsv, downloadCsv } from '@/lib/csv';
import { fmtDateShort, fmtWeekLabel } from '@/lib/format';
import { onSchedule, openBlockers, statusTone } from '@/lib/report-utils';
import type { Report, SortKey } from '@/lib/types';
import styles from './DashboardScreen.module.css';

export interface DashboardScreenProps {
  reports: Report[];
  darkMode: boolean;
  onToggleDarkMode: () => void;
  filterStatus: string;
  onFilterStatusChange: (value: string) => void;
  filterClient: string;
  onFilterClientChange: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  sortBy: SortKey;
  onSortByChange: (value: SortKey) => void;
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
  darkMode,
  onToggleDarkMode,
  filterStatus,
  onFilterStatusChange,
  filterClient,
  onFilterClientChange,
  search,
  onSearchChange,
  sortBy,
  onSortByChange,
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

  // Lines 661-676: table rows, including the status badge and the
  // Continue(draft)/View(else) action button.
  const tableRows = filtered.map((r) => {
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

  // Line 730-731: lightPanelStyle wraps the filter bar in a white panel when
  // dark mode is on; the header itself always stays white (line 723).
  const filterBarStyle: CSSProperties = darkMode
    ? {
        background: '#FFFFFF',
        padding: '28px',
        border: '1px solid #2E2E2A',
        display: 'flex',
        gap: '16px',
        alignItems: 'flex-end',
        marginBottom: '22px',
        flexWrap: 'wrap',
      }
    : {
        display: 'flex',
        gap: '16px',
        alignItems: 'flex-end',
        marginBottom: '22px',
        flexWrap: 'wrap',
      };

  return (
    <div>
      <div className={styles.header}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size brand logo, next/image adds no value here */}
          <img src="/logo-horizontal.svg" alt="Foundation First Marketing" className={styles.logo} />
          <span className={styles.wordmark}>Weekly Reports</span>
        </div>
        <div className={styles.headerActions}>
          <Switch label="Dark Mode" checked={darkMode} onChange={onToggleDarkMode} />
          <div className={styles.headerButtons}>
            <Button variant="outline" size="md" onClick={handleExportCsv}>
              Export All Tasks (CSV)
            </Button>
            <Button variant="primary" size="md" onClick={onNewReport}>
              New Report
            </Button>
          </div>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.statsGrid}>
          <StatCard label="Total Reports" value={String(reports.length)} dark={darkMode} />
          <StatCard label="Avg. Tasks On Schedule" value={`${avgPct}%`} dark={darkMode} />
          <StatCard
            label="Open Blockers (Latest)"
            value={latest ? String(openBlockers(latest)) : '0'}
            dark={darkMode}
          />
          <StatCard label="Active Clients" value={String(FF_CLIENTS.length)} dark={darkMode} />
        </div>

        <div style={filterBarStyle}>
          <div style={{ width: 170 }}>
            <Select
              label="Status"
              options={[...STATUS_FILTER_OPTIONS]}
              value={filterStatus}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => onFilterStatusChange(e.target.value)}
            />
          </div>
          <div style={{ width: 280 }}>
            <Select
              label="Client"
              options={[...CLIENT_FILTER_OPTIONS]}
              value={filterClient}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => onFilterClientChange(e.target.value)}
            />
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
              onChange={(e: ChangeEvent<HTMLSelectElement>) => onSortByChange(e.target.value as SortKey)}
            />
          </div>
        </div>

        <Table columns={TABLE_COLUMNS} rows={tableRows} />
        {tableRows.length === 0 ? <div className={styles.emptyState}>No reports match these filters.</div> : null}
      </div>
    </div>
  );
}
