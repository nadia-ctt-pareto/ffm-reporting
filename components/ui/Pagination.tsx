import styles from './Pagination.module.css';

export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

/** Prev/Next + "Page x of y", token-styled. Used by the dashboard's reports table. */
export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.navButton}
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Prev
      </button>
      <span className={styles.status}>
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        className={styles.navButton}
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
