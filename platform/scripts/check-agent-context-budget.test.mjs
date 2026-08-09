import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeAgentContext } from './check-agent-context-budget.mjs';

function baseFiles() {
  const skillOverrides = Object.fromEntries(
    Array.from({ length: 111 }, (_, index) => [`off-project-${index}`, 'off']),
  );
  return [
    { path: 'CLAUDE.md', content: '# Contract\n\nCompact rules.\n' },
    { path: 'AGENTS.md', content: '# Pointer\n\nRead CLAUDE.md.\n' },
    {
      path: '.claude/settings.json',
      content: JSON.stringify({
        enableWorkflows: false,
        enabledPlugins: {
          one: false,
          two: false,
          three: false,
          four: false,
          five: false,
        },
        skillOverrides,
      }),
    },
    {
      path: 'docs/CODEMAPS/current-tasks.md',
      content: '# Current Task Index\n\nNo active tasks.\n',
    },
  ];
}

test('compact canonical guidance stays within every context budget', () => {
  const result = analyzeAgentContext(baseFiles());
  assert.deepEqual(result.violations, []);
  assert.equal(result.metrics.projectSkillCount, 0);
  assert.equal(
    result.metrics.alwaysLoadedBytes,
    Buffer.byteLength(baseFiles()[0].content) + Buffer.byteLength(baseFiles()[1].content),
  );
});

test('oversized canonical and path guidance fail with actionable violations', () => {
  const files = baseFiles();
  files[0].content = `${'word '.repeat(1_001)}\n`;
  files.push({
    path: '.github/instructions/module.instructions.md',
    content: Array.from(
      { length: 40 },
      (_, index) => `- duplicated canonical module policy ${index} with unnecessary detail`,
    ).join('\n'),
  });

  const result = analyzeAgentContext(files);
  assert.ok(result.violations.some((violation) => violation.startsWith('CLAUDE.md words')));
  assert.ok(result.violations.some((violation) => violation.includes('per-file budget')));
  assert.ok(result.violations.some((violation) => violation.includes('pointer-only')));
});

test('project skill growth beyond the approved bundle fails even when each skill is small', () => {
  const files = baseFiles();
  for (let index = 0; index < 46; index += 1) {
    files.push({
      path: `.claude/skills/skill-${index}/SKILL.md`,
      content: `---\nname: skill-${index}\ndescription: test\n---\n`,
    });
  }

  const result = analyzeAgentContext(files);
  assert.ok(result.violations.includes('project skill count is 46, budget is 45'));
});

test('missing skill scoping and enabled plugins fail closed', () => {
  const files = baseFiles();
  files.find((file) => file.path === '.claude/settings.json').content = JSON.stringify({
    enableWorkflows: true,
    enabledPlugins: { one: true },
    skillOverrides: { one: 'on' },
  });

  const result = analyzeAgentContext(files);
  assert.ok(result.violations.includes('disabled skill overrides are 0, expected 111'));
  assert.ok(result.violations.includes('disabled plugins are 0, expected 5'));
  assert.ok(result.violations.includes('every project skill override must be off'));
  assert.ok(result.violations.includes('every project plugin entry must be disabled'));
  assert.ok(result.violations.includes('Claude workflows must remain disabled for this project'));
});
