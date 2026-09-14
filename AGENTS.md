<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Repository workflow rules

- After completing and verifying a requested code change, always commit the task-related files and push the commit to the current remote branch unless the user explicitly says not to push.
- Never include unrelated working-tree changes in a commit. Preserve them for the user.
- Never commit secrets, credentials, `.env` files, or other sensitive configuration.
- Run the relevant lint, tests, and production build before pushing when those checks are available.
- When a task adds or changes a Supabase migration, compare local and linked migration history, apply every pending migration to the linked database before deploying application code that depends on it, and confirm the histories match afterward.
- After pushing, ensure the application is deployed through the configured deployment workflow and verify the affected production route before reporting completion. A successful Git push alone is not sufficient verification.
- If migrations or deployment cannot be completed because access or deployment tooling is unavailable, report the task as blocked instead of claiming it is complete.
- Report the pushed branch and commit hash in the final response.
