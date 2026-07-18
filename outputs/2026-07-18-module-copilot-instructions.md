# Module Copilot instructions

Added path-scoped GitHub Copilot instruction adapters for the developed Modules so future sessions receive established local constraints while editing relevant files.

## Coverage

- Shared Module contract: `.github/instructions/module-development.instructions.md`
- DealPilot: `.github/instructions/dealpilot.instructions.md`
- JobPilot: `.github/instructions/jobpilot.instructions.md`
- Relationship: `.github/instructions/relationship.instructions.md`
- Task Manager: `.github/instructions/task-manager.instructions.md`
- Relationship Helpdesk: `.github/instructions/helpdesk.instructions.md`

The adapters keep `CLAUDE.md` canonical, point to the matching wiki and canonical task, capture load-bearing design/trust/reuse rules, and avoid copying full plans. Calendar is deliberately excluded as a Module because TASK-014/ADR-108 define Calendar as a View kind and Google Calendar as an Integration.

## Verification

- Six instruction files passed `applyTo` frontmatter, canonical-pointer, and current-path coverage checks.
- Task Manager projection regenerated with 24 canonical tasks.
- `@bridge/web`: 49/49 tests passed.

Tracked by TASK-024, AP-040, and ADR-113.
