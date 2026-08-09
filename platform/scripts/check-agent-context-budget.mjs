import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

export const DEFAULT_CONTEXT_BUDGETS = Object.freeze({
  claudeBytes: 8_192,
  claudeWords: 1_000,
  agentsBytes: 1_024,
  activeTasksBytes: 4_096,
  pathInstructionBytes: 1_024,
  pathInstructionsTotalBytes: 2_048,
  pathInstructionBodyLines: 12,
  projectSkillCount: 45,
  projectSkillBytes: 524_288,
  alwaysLoadedBytes: 10_240,
  disabledSkillOverrides: 111,
  // Five project plugin entries, all disabled. Project settings are COMMITTED and
  // apply to every agent in this repo, so an enabled plugin here is always-loaded
  // skill metadata charged to every session — a reviewed recurring cost per
  // CLAUDE.md. Enable plugins per-user in ~/.claude/settings.json instead, where
  // the choice is personal and costs no one else context.
  disabledPlugins: 5,
});

function bytes(content) {
  return Buffer.byteLength(content, 'utf8');
}

function words(content) {
  return content.trim() ? content.trim().split(/\s+/).length : 0;
}

function instructionBodyLines(content) {
  const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
  return body.split(/\r?\n/).filter((line) => line.trim()).length;
}

export function analyzeAgentContext(files, budgets = DEFAULT_CONTEXT_BUDGETS) {
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const violations = [];
  const required = (path) => {
    const content = byPath.get(path);
    if (content === undefined) violations.push(`${path} is missing`);
    return content ?? '';
  };
  const claude = required('CLAUDE.md');
  const agents = required('AGENTS.md');
  const activeTasks = required('docs/CODEMAPS/current-tasks.md');
  const settingsContent = required('.claude/settings.json');
  const pathInstructions = files.filter((file) =>
    /^\.github\/instructions\/.+\.instructions\.md$/.test(file.path));
  const projectSkills = files.filter((file) =>
    /^\.claude\/skills\/.+\/SKILL\.md$/.test(file.path));
  let settings = {};
  try {
    settings = JSON.parse(settingsContent);
  } catch {
    violations.push('.claude/settings.json is not valid JSON');
  }
  const skillOverrides = settings.skillOverrides ?? {};
  const plugins = settings.enabledPlugins ?? {};

  const metrics = {
    claudeBytes: bytes(claude),
    claudeWords: words(claude),
    agentsBytes: bytes(agents),
    activeTasksBytes: bytes(activeTasks),
    pathInstructionCount: pathInstructions.length,
    pathInstructionsTotalBytes: pathInstructions.reduce((sum, file) => sum + bytes(file.content), 0),
    projectSkillCount: projectSkills.length,
    projectSkillBytes: projectSkills.reduce((sum, file) => sum + bytes(file.content), 0),
    disabledSkillOverrides:
      Object.values(skillOverrides).filter((value) => value === 'off').length,
    disabledPlugins: Object.values(plugins).filter((value) => value === false).length,
  };
  metrics.alwaysLoadedBytes =
    metrics.claudeBytes + metrics.agentsBytes + metrics.pathInstructionsTotalBytes;
  metrics.approximateAlwaysLoadedTokens = Math.ceil(metrics.alwaysLoadedBytes / 4);

  const over = (metric, limit, label = metric) => {
    if (metrics[metric] > limit) {
      violations.push(`${label} is ${metrics[metric]}, budget is ${limit}`);
    }
  };
  over('claudeBytes', budgets.claudeBytes, 'CLAUDE.md bytes');
  over('claudeWords', budgets.claudeWords, 'CLAUDE.md words');
  over('agentsBytes', budgets.agentsBytes, 'AGENTS.md bytes');
  over('activeTasksBytes', budgets.activeTasksBytes, 'active task index bytes');
  over(
    'pathInstructionsTotalBytes',
    budgets.pathInstructionsTotalBytes,
    'path instruction total bytes',
  );
  over('projectSkillCount', budgets.projectSkillCount, 'project skill count');
  over('projectSkillBytes', budgets.projectSkillBytes, 'project skill bytes');
  over('alwaysLoadedBytes', budgets.alwaysLoadedBytes, 'always-loaded guidance bytes');
  if (metrics.disabledSkillOverrides !== budgets.disabledSkillOverrides) {
    violations.push(
      `disabled skill overrides are ${metrics.disabledSkillOverrides}, `
        + `expected ${budgets.disabledSkillOverrides}`,
    );
  }
  if (metrics.disabledPlugins !== budgets.disabledPlugins) {
    violations.push(
      `disabled plugins are ${metrics.disabledPlugins}, expected ${budgets.disabledPlugins}`,
    );
  }
  if (Object.values(skillOverrides).some((value) => value !== 'off')) {
    violations.push('every project skill override must be off');
  }
  if (Object.values(plugins).some((value) => value !== false)) {
    violations.push('every project plugin entry must be disabled');
  }
  if (settings.enableWorkflows !== false) {
    violations.push('Claude workflows must remain disabled for this project');
  }

  for (const file of pathInstructions) {
    const fileBytes = bytes(file.content);
    const bodyLines = instructionBodyLines(file.content);
    if (fileBytes > budgets.pathInstructionBytes) {
      violations.push(
        `${file.path} is ${fileBytes} bytes, per-file budget is ${budgets.pathInstructionBytes}`,
      );
    }
    if (bodyLines > budgets.pathInstructionBodyLines) {
      violations.push(
        `${file.path} has ${bodyLines} non-empty body lines; path guidance must stay pointer-only`,
      );
    }
  }

  return { metrics, violations };
}

async function collectFiles(directory, predicate, repoRoot) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path, predicate, repoRoot));
    else if (predicate(path)) {
      files.push({
        path: relative(repoRoot, path).replaceAll('\\', '/'),
        content: await readFile(path, 'utf8'),
      });
    }
  }
  return files;
}

async function isIgnored(repoRoot, path) {
  try {
    await execFileAsync('git', ['check-ignore', '--quiet', '--', path], { cwd: repoRoot });
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

export async function collectAgentContextFiles(repoRoot) {
  const requiredPaths = [
    'CLAUDE.md',
    'AGENTS.md',
    '.claude/settings.json',
    'docs/CODEMAPS/current-tasks.md',
  ];
  const files = await Promise.all(requiredPaths.map(async (path) => ({
    path,
    content: await readFile(resolve(repoRoot, path), 'utf8'),
  })));
  files.push(...await collectFiles(
    resolve(repoRoot, '.github/instructions'),
    (path) => path.endsWith('.instructions.md'),
    repoRoot,
  ));
  const projectSkills = await collectFiles(
    resolve(repoRoot, '.claude/skills'),
    (path) => basename(path) === 'SKILL.md',
    repoRoot,
  );
  for (const skill of projectSkills) {
    if (!await isIgnored(repoRoot, skill.path)) files.push(skill);
  }
  return files;
}

async function main() {
  const repoRoot = resolve(import.meta.dirname, '..', '..');
  const result = analyzeAgentContext(await collectAgentContextFiles(repoRoot));
  const { metrics } = result;
  console.log(
    `Agent context: ${metrics.alwaysLoadedBytes} always-loaded bytes `
      + `(~${metrics.approximateAlwaysLoadedTokens} tokens), `
      + `${metrics.activeTasksBytes} active-task bytes, `
      + `${metrics.projectSkillCount} project skills, `
      + `${metrics.disabledSkillOverrides} skill overrides.`,
  );
  if (result.violations.length > 0) {
    for (const violation of result.violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
