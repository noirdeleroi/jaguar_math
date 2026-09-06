import styles from "./route-loading.module.css";

function DataSkeleton() {
  return <><div className={`${styles.bar} ${styles.eyebrow}`} /><div className={`${styles.bar} ${styles.title}`} /><div className={`${styles.bar} ${styles.description}`} /><div className={`${styles.bar} ${styles.shortDescription}`} /><div className={styles.stats}><div className={styles.card} /><div className={styles.card} /><div className={styles.card} /></div><div className={`${styles.card} ${styles.panel}`} /></>;
}

export function TeacherRouteLoading() {
  return <main className={`teacher-main ${styles.loading}`} aria-busy="true"><span className={styles.status} role="status">Loading page data</span><DataSkeleton /></main>;
}

export function StudentRouteLoading() {
  return <main className={styles.studentLoading} aria-busy="true"><div className={styles.studentContainer}><header className={styles.studentHeader}><div className={`${styles.bar} ${styles.brandPlaceholder}`} /><div className={`${styles.bar} ${styles.accountPlaceholder}`} /></header><section className={styles.studentHeading}><span className={styles.status} role="status">Loading page data</span><DataSkeleton /></section><div className={`${styles.card} ${styles.studentHero}`} /></div></main>;
}
