'use client';

import { useCallback, useEffect, useState } from 'react';
import { getReportsRepository } from '../data';
import type { Project } from '../types';

/**
 * Phase 6a: the Project entity's sibling of useReports.ts -- identical
 * optimistic-update pattern, over `getReportsRepository().getProjects()`.
 * Still only ever goes through `getReportsRepository()`, never a concrete
 * repository class.
 */
export interface UseProjectsResult {
  /** null until the first repository read resolves (avoids hydration mismatch). */
  projects: Project[] | null;
  /** Optimistic local update + fire-and-forget persistence. */
  upsertProject: (project: Project) => void;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<Project[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getReportsRepository()
      .getProjects()
      .then((all) => {
        if (!cancelled) setProjects(all);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const upsertProject = useCallback((project: Project) => {
    setProjects((prev) => {
      if (!prev) return prev;
      const exists = prev.some((p) => p.id === project.id);
      return exists ? prev.map((p) => (p.id === project.id ? project : p)) : [...prev, project];
    });
    void getReportsRepository().upsertProject(project);
  }, []);

  return { projects, upsertProject };
}
