"use client";

import { useRouter } from "next/navigation";
import JaguarGrapher from "@/app/components/grapher/JaguarGrapher";
import styles from "./grapher-page.module.css";

export default function StandaloneGrapher() {
  const router = useRouter();

  return <main className={styles.page}>
    <div className={styles.shell}>
      <JaguarGrapher
        onRequestClose={() => router.push("/")}
        storageKey="jaguar:grapher:standalone:v1"
      />
    </div>
  </main>;
}
