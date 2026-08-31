/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";

export default function GoogleAvatar({ fullName, photoUrl }: { fullName: string; photoUrl?: string }) {
  const normalizedPhotoUrl = photoUrl?.trim().startsWith("//") ? `https:${photoUrl.trim()}` : photoUrl?.trim(); const [photoUnavailable, setPhotoUnavailable] = useState(!normalizedPhotoUrl);
  if (photoUnavailable || !normalizedPhotoUrl) return <span aria-hidden="true" className="google-avatar">{initials(fullName)}</span>;
  return <span aria-hidden="true" className="google-avatar">{/* Google provides this externally hosted profile image. */}<img alt="" onError={() => setPhotoUnavailable(true)} referrerPolicy="no-referrer" src={normalizedPhotoUrl} /></span>;
}
