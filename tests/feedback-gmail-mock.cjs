// Local integration-test preload only. Never loaded by the application itself.
if (process.env.FEEDBACK_EMAIL_TEST_MODE !== "1" || process.env.VERCEL)
  throw new Error("The Gmail mock is restricted to an explicitly enabled local test server.");
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = String(input?.url ?? input);
  if (url === "https://oauth2.googleapis.com/token" && new URLSearchParams(options?.body).get("refresh_token")?.startsWith("feedback-qa-"))
    return Response.json({ access_token: "feedback-qa-local-token", expires_in: 3600 });
  if (url.includes("gmail.googleapis.com/")) {
    const raw = JSON.parse(options.body).raw;
    const message = Buffer.from(raw, "base64url").toString();
    if (options.headers.Authorization !== "Bearer feedback-qa-local-token" || !/^To: feedback-qa-[^\r\n]+@example\.test\r\n/.test(message))
      throw new Error("The local mock blocks all non-fixture email sends.");
    if (!message.includes('filename="your-test-feedback.pdf"')) throw new Error("Feedback attachment missing.");
    return Response.json({ id: "feedback-qa-mocked-gmail-receipt" });
  }
  return originalFetch(input, options);
};
