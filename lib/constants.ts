// Ported verbatim from design-source/original-dashboard.dc.html script block.

import type { RiskSeverity, TaskStatus } from './types';

// Line 415
export const FF_CLIENTS = [
  'Helitech Foundation & Waterproofing',
  'DryRoot Waterproofing',
  'Summit Basement Solutions',
  'TerraFirm Foundation Repair',
] as const;

export interface SelectOption {
  value: string;
  label: string;
}

// Line 738: statusFilterOptions
export const STATUS_FILTER_OPTIONS = ['All', 'Draft', 'Final', 'Sent'] as const;

// Line 738: clientFilterOptions
export const CLIENT_FILTER_OPTIONS = ['All', ...FF_CLIENTS] as const;

// Line 781: statusEditOptions (detail dialog -- no 'All')
export const STATUS_EDIT_OPTIONS = ['Draft', 'Final', 'Sent'] as const;

// Line 738: sortOptions
export const SORT_OPTIONS: SelectOption[] = [
  { value: 'week_desc', label: 'Week (Newest First)' },
  { value: 'week_asc', label: 'Week (Oldest First)' },
  { value: 'status', label: 'Status' },
  { value: 'blockers_desc', label: 'Open Blockers' },
];

// Line 762: taskStatusOptions
export const TASK_STATUS_OPTIONS: TaskStatus[] = ['Complete', 'In Progress', 'Blocked'];

// Line 763: riskSeverityOptions
export const RISK_SEVERITY_OPTIONS: RiskSeverity[] = ['Blocked', 'At Risk'];
