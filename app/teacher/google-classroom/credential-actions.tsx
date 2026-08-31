"use client";

import { useState } from "react";

type Credential = { fullName: string; emailAddress: string; temporaryPassword: string };
const csvField = (value: string) => `"${value.replaceAll('"', '""')}"`;
const html = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export default function CredentialActions({ credentials }: { credentials: Credential[] }) {
  const [error, setError] = useState("");
  function download() {
    const rows = ["Full name,Email,One-time temporary password", ...credentials.map((credential) => [credential.fullName, credential.emailAddress, credential.temporaryPassword].map(csvField).join(","))]; const blob = new Blob([rows.join("\r\n")], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "jaguar-math-student-credentials.csv"; link.click(); URL.revokeObjectURL(url);
  }
  function print() {
    setError(""); const popup = window.open("", "jaguar-math-login-slips", "width=720,height=900");
    if (!popup) { setError("Your browser blocked the print window. Allow pop-ups and try again."); return; }
    popup.opener = null;
    const slips = credentials.map((credential) => `<article><h1>Jaguar Math</h1><p><strong>${html(credential.fullName)}</strong></p><p>Email: ${html(credential.emailAddress)}</p><p>Temporary password: <code>${html(credential.temporaryPassword)}</code></p><small>Sign in, then choose a new private password.</small></article>`).join("");
    popup.document.write(`<!doctype html><html><head><title>Jaguar Math login slips</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#182f2a}article{break-inside:avoid;border:1px solid #31554b;border-radius:8px;margin:0 0 16px;padding:20px}h1{margin:0 0 14px;font-size:20px}p{margin:8px 0}code{font-size:16px;font-weight:700}small{display:block;margin-top:16px;color:#49635b}@media print{body{margin:0}article{margin:0 0 12px}}</style></head><body>${slips}</body></html>`); popup.document.close(); popup.focus(); popup.print();
  }
  return <div className="credential-actions"><button className="secondary-inline-button" onClick={download} type="button">Download credentials CSV</button><button className="secondary-inline-button" onClick={print} type="button">Print login slips</button>{error && <p className="form-error" role="alert">{error}</p>}</div>;
}
