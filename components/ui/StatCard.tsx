import styles from './StatCard.module.css';

export interface StatCardProps {
  label: string;
  value: string;
  dark?: boolean;
}

export function StatCard({ label, value, dark = false }: StatCardProps) {
  return (
    <div className={`${styles.card} ${dark ? styles.dark : ''}`}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
    </div>
  );
}
