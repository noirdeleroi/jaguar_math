import { randomUUID } from "node:crypto";
import { feedbackScore, validFeedbackEmail, type FeedbackRow } from "./mixed-feedback.ts";

const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const base64 = (s: string | Uint8Array) => Buffer.from(s).toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
export type FeedbackEmail = { recipient: string; name: string; title: string; rows: FeedbackRow[]; pdf: Uint8Array };

export function feedbackEmailContent(input: Omit<FeedbackEmail, "pdf">) {
  const { correct, total, outOfTen } = feedbackScore(input.rows);
  const name = input.name.trim().split(/\s+/)[0] || "there";
  const missed = input.rows.filter(r => !r.isCorrect).map(r => r.position).join(", ");
  const advice = missed ? `Revisit questions ${missed}. Compare your answers with the correct answers, then try those questions again.` : "Excellent work - you answered every question correctly. Keep your paper as a revision resource.";
  const text = `Hi ${name},\n\nHere is your personal feedback for ${input.title}.\n\nScore: ${outOfTen}/10\nCorrect answers: ${correct}/${total}\n\n${advice}\n\nYour attached feedback PDF contains your question paper, scanned answer sheet and a question-by-question answer check.\n\nQuestion | Your answer | Correct answer | Result\n${input.rows.map(r => `${r.position} | ${r.selected} | ${r.correct} | ${r.isCorrect ? "Correct" : "Review"}`).join("\n")}\n\nIf you think an answer was read incorrectly, please ask me to review your scan.\n\nMr. Korshunov\nJaguar Math`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:24px 12px;background:#f5f0e7;color:#17342e;font-family:Arial,Helvetica,sans-serif"><div style="max-width:600px;margin:auto;background:#fffdf7;border:1px solid #d8d0c1;border-radius:12px;overflow:hidden"><div style="padding:28px;background:#1c5b4d;color:white"><div style="font-size:12px;letter-spacing:2px">JAGUAR MATH · PERSONAL FEEDBACK</div><h1 style="font-family:Georgia,serif;font-size:27px;margin:14px 0 0">${escape(input.title)}</h1></div><div style="padding:28px"><p>Hi ${escape(name)},</p><p>Your marked test is ready. Use this feedback to see what went well and what to practise next.</p><div style="padding:20px;background:#edf3ed;border-radius:8px;margin:22px 0"><strong style="font-size:34px;color:#1c5b4d">${outOfTen}/10</strong><div style="margin-top:6px">${correct}/${total} questions correct</div></div><p style="line-height:1.6">${escape(advice)}</p><p style="line-height:1.6">Your attached PDF includes <strong>your question paper, your scanned answer sheet, and your answer check</strong>.</p><table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="background:#f1ece2">${["Question", "Your answer", "Correct", "Result"].map(s => `<th style="padding:10px 6px;text-align:left">${s}</th>`).join("")}</tr></thead><tbody>${input.rows.map(r => `<tr><td style="padding:9px 6px;border-bottom:1px solid #e5ddd1">${r.position}</td><td style="padding:9px 6px;border-bottom:1px solid #e5ddd1">${r.selected}</td><td style="padding:9px 6px;border-bottom:1px solid #e5ddd1">${r.correct}</td><td style="padding:9px 6px;border-bottom:1px solid #e5ddd1;color:${r.isCorrect ? "#1c5b4d" : "#a33b27"}">${r.isCorrect ? "Correct" : "Review"}</td></tr>`).join("")}</tbody></table><p style="font-size:13px;line-height:1.6;color:#557168;margin-top:22px">If you think an answer was read incorrectly, please ask me to review your scan.</p><p style="margin-top:24px">Mr. Korshunov<br><span style="color:#557168">Jaguar Math</span></p></div></div></body></html>`;
  return { text, html };
}

export function feedbackMime(input: FeedbackEmail) {
  if (!validFeedbackEmail(input.recipient)) throw new Error("A valid student email is required.");
  const mixed = `mixed_${randomUUID()}`, alternative = `alternative_${randomUUID()}`;
  const { text, html } = feedbackEmailContent(input);
  const subject = Buffer.from(`Jaguar Math - ${input.title} - Your test feedback`).toString("base64");
  return `To: ${input.recipient}\r\nSubject: =?UTF-8?B?${subject}?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${mixed}"\r\n\r\n--${mixed}\r\nContent-Type: multipart/alternative; boundary="${alternative}"\r\n\r\n--${alternative}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(text)}\r\n--${alternative}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(html)}\r\n--${alternative}--\r\n\r\n--${mixed}\r\nContent-Type: application/pdf; name="your-test-feedback.pdf"\r\nContent-Disposition: attachment; filename="your-test-feedback.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64(input.pdf)}\r\n--${mixed}--\r\n`;
}

export class FeedbackSendError extends Error {
  readonly uncertain: boolean;
  constructor(message: string, uncertain: boolean) { super(message); this.uncertain = uncertain; }
}

export async function sendFeedbackEmail(token: string, input: FeedbackEmail, request: typeof fetch = fetch) {
  const raw = Buffer.from(feedbackMime(input)).toString("base64url");
  if (raw.length > 25_000_000) throw new FeedbackSendError("This feedback attachment is too large to email.", false);
  let response: Response;
  try {
    response = await request("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw }), signal: AbortSignal.timeout(25_000), cache: "no-store",
    });
  } catch { throw new FeedbackSendError("Gmail did not confirm delivery. Check Sent mail before trying again.", true); }
  const result = await response.json().catch(() => null) as { id?: string } | null;
  if (!response.ok) throw new FeedbackSendError(response.status === 401 || response.status === 403
    ? "Reconnect Google to enable feedback email delivery."
    : response.status === 429 ? "Gmail is temporarily limiting sends. Try again later."
      : "Gmail could not send this feedback.", response.status >= 500 || response.status === 408);
  if (!result?.id) throw new FeedbackSendError("Gmail did not return a delivery receipt. Check Sent mail.", true);
  return result.id;
}
