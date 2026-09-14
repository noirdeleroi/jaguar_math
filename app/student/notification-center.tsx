"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { StudentNotification, StudentNotificationKind } from "@/lib/student-notifications";
import { createClient } from "@/lib/supabase/client";
import { markAllStudentNotificationsRead, markStudentNotificationRead } from "./actions";

const iconByKind: Record<StudentNotificationKind, string> = {
  assessment_new: "＋",
  assessment_score_released: "%",
  assessment_review_released: "✓",
  assessment_pdf_released: "↓",
  star_gained: "★",
  skull_gained: "☠",
  homework_status: "H",
  classwork_status: "C",
  classwork_note: "!",
};

function relativeTime(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return formatter.format(days, "day");
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

type RealtimeNotification = {
  id: string;
  kind: StudentNotificationKind;
  title: string;
  body: string;
  href: string;
  created_at: string;
  read_at: string | null;
};

function fromRealtime(row: RealtimeNotification): StudentNotification {
  return { id: row.id, kind: row.kind, title: row.title, body: row.body, href: row.href, createdAt: row.created_at, readAt: row.read_at };
}

export default function NotificationCenter({ initialNotifications, initialUnreadCount, studentId }: { initialNotifications: StudentNotification[]; initialUnreadCount: number; studentId: string }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const unreadIdsRef = useRef(new Set(initialNotifications.filter((notification) => !notification.readAt).map((notification) => notification.id)));
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`student-notifications:${studentId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "student_notifications", filter: `student_id=eq.${studentId}` }, (payload) => {
        const notification = fromRealtime(payload.new as RealtimeNotification);
        setNotifications((current) => [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 24));
        if (!notification.readAt && !unreadIdsRef.current.has(notification.id)) {
          unreadIdsRef.current.add(notification.id);
          setUnreadCount((current) => current + 1);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "student_notifications", filter: `student_id=eq.${studentId}` }, (payload) => {
        const notification = fromRealtime(payload.new as RealtimeNotification);
        setNotifications((current) => current.map((item) => item.id === notification.id ? notification : item));
        if (notification.readAt && unreadIdsRef.current.delete(notification.id)) setUnreadCount((current) => Math.max(0, current - 1));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [studentId]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function openNotification(notification: StudentNotification) {
    if (!notification.readAt) {
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt } : item));
      if (unreadIdsRef.current.delete(notification.id)) setUnreadCount((current) => Math.max(0, current - 1));
    }
    setOpen(false);
    startTransition(async () => {
      if (!notification.readAt) await markStudentNotificationRead(notification.id);
      router.push(notification.href);
    });
  }

  function markAllRead() {
    const previousNotifications = notifications;
    const previousUnreadCount = unreadCount;
    const previousUnreadIds = new Set(unreadIdsRef.current);
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((notification) => notification.readAt ? notification : { ...notification, readAt }));
    unreadIdsRef.current.clear();
    setUnreadCount(0);
    startTransition(async () => {
      const result = await markAllStudentNotificationsRead();
      if ("error" in result) {
        setNotifications(previousNotifications);
        setUnreadCount(previousUnreadCount);
        unreadIdsRef.current = previousUnreadIds;
      }
    });
  }

  return (
    <div className="notification-center" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className={`notification-bell ${open ? "is-open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
        {unreadCount > 0 ? <span>{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>
      {open ? (
        <section aria-label="Student notifications" className="notification-popover" role="dialog">
          <header>
            <div><p className="eyebrow">Your activity</p><h2>Notifications</h2></div>
            {unreadCount ? <button disabled={isPending} onClick={markAllRead} type="button">Mark all read</button> : <span>All caught up</span>}
          </header>
          {notifications.length ? (
            <div className="notification-list">
              {notifications.map((notification) => (
                <button className={notification.readAt ? "" : "is-unread"} key={notification.id} onClick={() => openNotification(notification)} type="button">
                  <span className={`notification-icon notification-icon-${notification.kind}`} aria-hidden="true">{iconByKind[notification.kind]}</span>
                  <span className="notification-copy">
                    <strong>{notification.title}</strong>
                    <small>{notification.body}</small>
                    <time dateTime={notification.createdAt} suppressHydrationWarning>{relativeTime(notification.createdAt)}</time>
                  </span>
                  {!notification.readAt ? <i aria-label="Unread" /> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="notification-empty"><span aria-hidden="true">✓</span><strong>You&apos;re all caught up.</strong><p>New assessments, results, Stars, and class records will appear here.</p></div>
          )}
        </section>
      ) : null}
    </div>
  );
}
