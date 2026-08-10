---
name: opensrc
description: Fetches and locally caches real dependency source code (npm, PyPI, crates.io, GitHub) via the vercel-labs/opensrc CLI, for reuse-intake research, clean-room protocol work, and any question about how an installed dependency actually behaves. Use before answering from documentation or type stubs alone when the real implementation is available and the question is about behavior, not just API shape.
---

# opensrc — real dependency source for research

Bridge's CLAUDE.md requires reuse intake before building a capability that
resembles an existing source: verify provenance and behavior against the
actual implementation, not just its docs. `opensrc` (Apache-2.0,
github.com/vercel-labs/opensrc) fetches and caches real package source
locally so that check can be done against code, not marketing copy.

## When to use

- Reuse-intake research (CLAUDE.md "Governance and engineering" — before
  building a capability resembling an existing source).
- Clean-room protocol provenance/behavior verification.
- Any question about how an installed dependency actually behaves that
  documentation doesn't answer precisely (edge cases, error shapes, internal
  assumptions).

Do not use it as a substitute for reading Bridge's own code, or for
questions answerable from a package's public API/types alone.

## Setup

```bash
npm install -g opensrc   # or: npx opensrc <command>
```

## Usage

```bash
opensrc path <package>[@version]   # fetches + caches, prints local path
```

Subsequent calls for the same package/version return the cached path
instantly. Pipe the path into normal file tools (`grep`, `find`, Read) —
opensrc only resolves and caches; it does no summarization of its own.

Supported registries: npm, PyPI, crates.io, GitHub (owner/repo).

## Scope note

This is a development-time research tool for Claude Code sessions working on
Bridge's own codebase. It is not a Bridge product capability — see TASK-044
scope for the separate, still-undecided question of exposing an
opensrc-backed code-research capability to Bridge's in-app Builder/Learning
Agents.
