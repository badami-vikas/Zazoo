---
title: Spec — Workspace Name Derivation
type: raw
doc_kind: design
status: draft
companions: []
related_wiki: ../wiki/foundational-agents.md
updated: 2026-07-09
tags: [onboarding, workspace, naming, ux]
---

# Workspace Name Derivation — Spec

## Rule

When a new workspace is created (onboarding flow), the name is derived automatically. No name entry field is shown to the user at creation time.

### Primary: email-based

Extract the domain from the user's email address (the part after `@`). Strip the TLD and any common hosting sub-domains (`mail.`, `m.`, etc.). Capitalise the result. Use it as the workspace name.

Examples:
- `alice@acmecorp.com` → `Acmecorp`
- `bob@stripe.com` → `Stripe`
- `carol@consulting.acme.co.uk` → `Acme`

Implementation: split on `@`, take the second part, strip TLD with a regex that handles `.co.uk`-style second-level TLDs, capitalise first letter.

### Fallback: first name

When the domain is a generic free-mail provider (gmail, yahoo, outlook, hotmail, icloud, proton, me.com, etc.), fall back to:

```
<FirstName>'s Workspace
```

`FirstName` is sourced from the name the user entered during account creation. If no first name is available, fall back to the literal string `My Workspace`.

## Editability

The derived name is always editable by the user. An "Edit name" affordance (inline edit or settings field) must be available immediately after onboarding and at any time thereafter from Settings → Organization.

The name change is a user-initiated action, not a governed proposal; it does not go through the Capability Trust Model approval flow.

## Scope

- Applies to the default workspace created during onboarding.
- Also applies when the user triggers a Fork ("request egg from spirit animal") — the forked workspace gets the same derivation applied unless the user explicitly names it during the fork flow.
- Does not apply to workspaces created programmatically via the API (callers must supply a name).
