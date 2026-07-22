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
import { PAGE_SIZE_OPTIONS, SORT_OPTIONS, STATUS_FILTER_OPTIONS } from '@/lib/constants';
import { buildAllTasksCsv, downloadCsv } from '@/lib/csv';
import { fmtDateShort, fmtWeekLabel } from '@/lib/format';
import { projectIdForClientName } from '@/lib/projects';
import { DELETE_REPORT_HINT } from '@/lib/report-access';
import { onSchedule, openBlockers, statusTone } from '@/lib/report-utils';
import type { Project, Report, SortKey } from '@/lib/types';
import styles from './DashboardScreen.module.css';

export interface DashboardScreenProps {
  reports: Report[];
  /** Phase 6a: dynamic client filter options ('All' + every known Project's name), replacing the static CLIENT_FILTER_OPTIONS. Filter *matching* logic is unchanged -- still compares `task.client` strings. Purely a <Select> concern -- NOT used to derive the "Active Clients" stat (see `projects` below). */
  clientOptions: string[];
  /** Phase 6a: the source of truth for the "Active Clients" StatCard -- null while still loading. Kept independent of `clientOptions` so a future second sentinel option in that list can never silently skew the count. */
  projects: Project[] | null;
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
  /**
   * Phase 8d (report delete): opens the shared delete-confirmation dialog (owned/hosted by
   * `DashboardPage`, not this screen -- see that file's own doc comment for
   * why dialog hosting lives at the Page-orchestrator level here rather
   * than in a per-row component) for the report with this id.
   */
  onDeleteReport: (id: string) => void;
  /**
   * Phase 8d (report delete): per-row gate for the row's Delete button -- mirrors
   * `app/(shell)/reports/[id]/page.tsx`'s `canDelete` computation exactly
   * (owner-or-admin in Supabase mode, unconditionally `true` in demo mode),
   * just evaluated once per row instead of once for a single report. A
   * function (not a precomputed field on each row) so `DashboardPage` can
   * compute it once, off `useSession()`, and apply it to every row without
   * threading a session object through this screen's own row-mapping code.
   */
  canDeleteReport: (report: Report) => boolean;
}

const TABLE_COLUMNS: TableColumn[] = [
  { key: 'week', label: 'Week' },
  { key: 'preparedFor', label: 'Prepared For' },
  { key: 'status', label: 'Status' },
  { key: 'tasks', label: 'Tasks On Sched.', align: 'center' },
  { key: 'blockers', label: 'Blockers', align: 'center' },
  { key: 'updated', label: 'Updated' },
  { key: 'actions', label: '', align: 'right', isAction: true },
];

export function DashboardScreen({
  reports,
  clientOptions,
  projects,
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
  onDeleteReport,
  canDeleteReport,
}: DashboardScreenProps) {
  // Lines 650-660: filter + sort.
  //
  // Phase 8c (THE CRUX -- rename safety): `filterClient` is a project NAME
  // (the <Select>'s options -- see `clientOptions` in DashboardPage.tsx),
  // but a task's stable link to its project is `projectId`, not `client`
  // (`client` is historical, free-text, and MUST NEVER be rewritten on
  // rename -- see CLAUDE.md's "THE CRUX"). Matching `t.client ===
  // filterClient` ALONE would silently stop matching every task recorded
  // BEFORE a rename the instant that rename happens (the task's `client`
  // string still says the OLD name; `filterClient` is now the NEW one).
  // `filterProjectId` resolves the selected name to its CURRENT project id
  // once per filter pass (not per task); a task matches if EITHER its own
  // `client` string still equals the selected name (the common, un-renamed
  // case) OR its `projectId` equals that same project's id (catches
  // pre-rename tasks) -- exact matches only, no fuzzy matching, mirroring
  // `projectIdForClientName`'s own contract.
  const filtered = useMemo(() => {
    const filterProjectId = filterClient === 'All' ? undefined : projectIdForClientName(filterClient, projects ?? []);
    const list = reports.filter(
      (r) =>
        (filterStatus === 'All' || r.status === filterStatus) &&
        (filterClient === 'All' ||
          r.tasks.some((t) => t.client === filterClient || (filterProjectId !== undefined && t.projectId === filterProjectId))) &&
        (search.trim() === '' ||
          (r.preparedFor + ' ' + fmtWeekLabel(r.weekStart, r.weekEnd)).toLowerCase().includes(search.toLowerCase()))
    );
    return [...list].sort((a, b) => {
      if (sortBy === 'week_asc') return a.weekEnd.localeCompare(b.weekEnd);
      if (sortBy === 'status') return a.status.localeCompare(b.status);
      if (sortBy === 'blockers_desc') return openBlockers(b) - openBlockers(a);
      return b.weekEnd.localeCompare(a.weekEnd);
    });
  }, [reports, filterStatus, filterClient, search, sortBy, projects]);

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
    const deletable = canDeleteReport(r);
    return {
      week: fmtWeekLabel(r.weekStart, r.weekEnd),
      preparedFor: r.preparedFor,
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
          {/* Phase 8d (report delete): row-level delete -- a Draft's ONLY other action is
              "Continue", so without this a draft was only deletable by
              hand-typing its /reports/[id] URL. Disabled-with-a-hint
              (never hidden) when `!deletable`, matching Phase 8c's
              ProjectDetailScreen precedent. */}
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
        title="Weekly Reports"
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
          <StatCard label="Active Clients" value={String(projects?.length ?? 0)} />
        </div>

        <div className={styles.filterBar}>
          <div className={styles.fieldStatus}>
            <Select label="Status" options={[...STATUS_FILTER_OPTIONS]} value={filterStatus} onChange={onFilterStatusChange} />
          </div>
          <div className={styles.fieldClient}>
            <Select label="Client" options={clientOptions} value={filterClient} onChange={onFilterClientChange} />
          </div>
          <div className={styles.fieldSearch}>
            <Input
              label="Search"
              placeholder="Week or contact"
              value={search}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onSearchChange(e.target.value)}
            />
          </div>
          <div className={styles.fieldSort}>
            <Select
              label="Sort By"
              options={SORT_OPTIONS}
              value={sortBy}
              onChange={(value) => onSortByChange(value as SortKey)}
            />
          </div>
          <div className={styles.fieldPageSize}>
            <Select label="Per Page" options={[...PAGE_SIZE_OPTIONS]} value={pageSize} onChange={onPageSizeChange} />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className={styles.emptyState}>No reports match these filters.</div>
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
