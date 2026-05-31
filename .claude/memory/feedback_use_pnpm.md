---
name: feedback_use_pnpm
description: Always use pnpm instead of npm for package management in this project
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 02c3652f-5e2e-4462-9fba-79665ff33870
---

Always use `pnpm` instead of `npm` for running scripts and package management in this project.

**Why:** User preference — they use pnpm as the package manager.

**How to apply:** For functions build: `cd functions && pnpm build`. For workspace-level commands, try `pnpm --filter <name> <script>` but fall back to `cd <dir> && pnpm <script>` if the filter doesn't match.
