"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
export default function LogoutButton() { const router = useRouter(); const [isLoading, setIsLoading] = useState(false); async function logout() { setIsLoading(true); await createClient().auth.signOut(); router.replace("/login"); router.refresh(); } return <button className="logout-button" disabled={isLoading} onClick={logout} type="button">{isLoading ? "Logging out…" : "Logout"}</button>; }
