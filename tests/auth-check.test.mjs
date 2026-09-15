import assert from "node:assert/strict";
import test from "node:test";
import { authFailureRequiresLogin, hasSupabaseAuthCookie } from "../lib/auth-check.ts";

test("recognizes complete and chunked Supabase session cookies", () => {
  assert.equal(hasSupabaseAuthCookie([{ name: "theme" }, { name: "sb-project-auth-token" }]), true);
  assert.equal(hasSupabaseAuthCookie([{ name: "sb-project-auth-token.0" }]), true);
  assert.equal(hasSupabaseAuthCookie([{ name: "theme" }]), false);
});

test("does not force logout for a temporary verification error with a session cookie", () => {
  assert.equal(authFailureRequiresLogin({ name: "AuthRetryableFetchError" }, true), false);
  assert.equal(authFailureRequiresLogin({ name: "AuthApiError" }, true), false);
});

test("requires login when the browser has no session or auth reports it missing", () => {
  assert.equal(authFailureRequiresLogin({ name: "AuthRetryableFetchError" }, false), true);
  assert.equal(authFailureRequiresLogin({ name: "AuthSessionMissingError" }, true), true);
});
