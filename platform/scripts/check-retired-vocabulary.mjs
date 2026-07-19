import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const PLATFORM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(PLATFORM_ROOT, "scripts", "retired-vocabulary-baseline.json");
const SOURCE_ROOTS = ["apps", "packages", "services", "tools"];
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SOURCE_EXTENSIONS = new Set([...TYPESCRIPT_EXTENSIONS, ".rs", ".sql"]);
const COMPATIBILITY_ADAPTERS = new Set([
  "apps/api/src/avatar-profile-v1-compat.ts",
  "apps/web/src/app/avatar/avatar-v1-compat.ts",
]);

const FAMILIES = {
  avatar_lifecycle: {
    tokens: ["egg", "eggs", "hatch", "hatched", "hatches", "hatching", "creature", "creatures", "mature", "maturity"],
    phrases: ["spirit animal", "avatar personality state", "14 step day 1 onboarding"],
  },
  ritual: { tokens: ["ritual", "rituals"] },
  workflow: { tokens: ["workflow", "workflows"] },
  brain: { tokens: ["brain", "brains"], allowPhrases: ["second brain"] },
  workspace: { tokens: ["workspace", "workspaces"] },
  package: { tokens: ["package", "packages"] },
  project: { tokens: ["project", "projects"] },
  initiative: { tokens: ["initiative", "initiatives"] },
  element: { tokens: ["element", "elements", "elementtype"] },
  touchpoint: { tokens: ["touchpoint", "touchpoints"] },
  incident: { tokens: ["incident", "incidents"] },
  artifact: { tokens: ["artifact", "artifacts"] },
  tool: { tokens: ["tool", "tools"] },
  knowledge: { tokens: ["knowledge", "knowledgebase"] },
  helpdesk: { tokens: ["helpdesk"] },
  legacy_plane: {
    phrases: ["mirror plane", "operational plane", "cross plane", "infra plane"],
  },
};

export function shouldIgnore(relativePath) {
  const normalized = relativePath.replaceAll(path.sep, "/");
  return (
    normalized.includes("/dist/") ||
    normalized.includes("/node_modules/") ||
    normalized.includes("/coverage/") ||
    normalized.includes("/target/") ||
    normalized.includes("/migrations/") ||
    normalized.includes("/test/") ||
    normalized.includes("/tests/") ||
    normalized.includes("/fixtures/") ||
    normalized.includes("/seed/") ||
    COMPATIBILITY_ADAPTERS.has(normalized) ||
    normalized.includes(".generated.") ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)
  );
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["dist", "node_modules", "coverage", "target", ".turbo"].includes(entry.name)) continue;
      files.push(...(await collectFiles(absolute)));
    } else if (isSourceFileName(entry.name)) {
      const relative = path.relative(PLATFORM_ROOT, absolute);
      if (!shouldIgnore(relative)) files.push({ absolute, relative: relative.replaceAll(path.sep, "/") });
    }
  }
  return files;
}

export function isSourceFileName(fileName) {
  return SOURCE_EXTENSIONS.has(path.extname(fileName));
}

function tokenize(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function familyMatches(value, definition) {
  return familyMatchCount(value, definition) > 0;
}

function phraseTokens(phrase) {
  return phrase.split(/\s+/).filter(Boolean);
}

function removePhrase(tokens, phrase) {
  const target = phraseTokens(phrase);
  if (target.length === 0) return tokens;
  const remaining = [];
  for (let index = 0; index < tokens.length;) {
    const matches = target.every((token, offset) => tokens[index + offset] === token);
    if (matches) {
      index += target.length;
    } else {
      remaining.push(tokens[index]);
      index += 1;
    }
  }
  return remaining;
}

function countPhrase(tokens, phrase) {
  const target = phraseTokens(phrase);
  if (target.length === 0) return 0;
  let count = 0;
  for (let index = 0; index <= tokens.length - target.length; index += 1) {
    if (target.every((token, offset) => tokens[index + offset] === token)) count += 1;
  }
  return count;
}

export function familyMatchCount(value, definition) {
  let remainingTokens = tokenize(value);
  for (const phrase of definition.allowPhrases ?? []) {
    remainingTokens = removePhrase(remainingTokens, phrase);
  }
  const phraseCount = (definition.phrases ?? []).reduce(
    (total, phrase) => total + countPhrase(remainingTokens, phrase),
    0,
  );
  const candidates = new Set(definition.tokens ?? []);
  const tokenCount = remainingTokens.filter((token) => candidates.has(token)).length;
  return phraseCount + tokenCount;
}

function emptyCount() {
  return {
    identifier: 0,
    string: 0,
    fingerprints: {
      identifier: {},
      string: {},
    },
  };
}

function matchFingerprint(value, context) {
  return createHash("sha256")
    .update(value)
    .update("\0")
    .update(context)
    .digest("hex")
    .slice(0, 32);
}

function addMatch(inventory, family, relativePath, kind, count, value, context) {
  inventory[family] ??= {};
  inventory[family][relativePath] ??= emptyCount();
  inventory[family][relativePath][kind] += count;
  const fingerprint = matchFingerprint(value, context);
  const fingerprints = inventory[family][relativePath].fingerprints[kind];
  fingerprints[fingerprint] = (fingerprints[fingerprint] ?? 0) + count;
}

function scopedDefinition(family, definition, relativePath) {
  return family === "brain" && !relativePath.startsWith("apps/web/src/app/")
    ? { ...definition, allowPhrases: [] }
    : definition;
}

function inspectValue(inventory, relativePath, value, kind, context = value) {
  for (const [family, definition] of Object.entries(FAMILIES)) {
    const scoped = scopedDefinition(family, definition, relativePath);
    const count = familyMatchCount(value, scoped);
    if (count > 0) {
      addMatch(inventory, family, relativePath, kind, count, value, context);
    }
  }
}

function nodeName(node, sourceFile) {
  if (!("name" in node) || !node.name) return "";
  return node.name.getText(sourceFile);
}

function syntaxContext(node, sourceFile) {
  const segments = [`node:${ts.SyntaxKind[node.kind]}`];
  let current = node.parent;
  while (current && !ts.isSourceFile(current) && segments.length < 5) {
    if (ts.isVariableDeclaration(current)) {
      segments.push(`variable:${nodeName(current, sourceFile)}`);
    } else if (ts.isParameter(current)) {
      segments.push(`parameter:${nodeName(current, sourceFile)}`);
    } else if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isMethodDeclaration(current)
    ) {
      segments.push(`function:${nodeName(current, sourceFile) || "<anonymous>"}`);
    } else if (
      ts.isPropertyDeclaration(current) ||
      ts.isPropertyAssignment(current) ||
      ts.isPropertySignature(current)
    ) {
      segments.push(`property:${nodeName(current, sourceFile)}`);
    } else if (ts.isReturnStatement(current)) {
      segments.push("return");
    } else if (ts.isCallExpression(current)) {
      segments.push(`call:${current.expression.getText(sourceFile)}`);
    } else if (ts.isJsxAttribute(current)) {
      segments.push(`jsx-attribute:${nodeName(current, sourceFile)}`);
    } else if (ts.isJsxElement(current)) {
      segments.push(`jsx:${current.openingElement.tagName.getText(sourceFile)}`);
    } else if (ts.isJsxFragment(current)) {
      segments.push("jsx-fragment");
    }
    current = current.parent;
  }
  return segments.join("|");
}

function constantStringParts(node) {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    return [node.text];
  }
  if (ts.isNumericLiteral(node)) return [node.text];
  if (node.kind === ts.SyntaxKind.TrueKeyword) return ["true"];
  if (node.kind === ts.SyntaxKind.FalseKeyword) return ["false"];
  if (node.kind === ts.SyntaxKind.NullKeyword) return ["null"];
  if (ts.isParenthesizedExpression(node)) return constantStringParts(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantStringParts(node.left);
    const right = constantStringParts(node.right);
    return left && right ? [...left, ...right] : null;
  }
  if (ts.isTemplateExpression(node)) {
    const parts = [node.head.text];
    for (const span of node.templateSpans) {
      const expressionParts = constantStringParts(span.expression);
      if (!expressionParts) return null;
      parts.push(...expressionParts, span.literal.text);
    }
    return parts;
  }
  return null;
}

function isCompositionNode(node) {
  return (
    (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) ||
    ts.isTemplateExpression(node)
  );
}

function hasCompositionAncestor(node) {
  let parent = node.parent;
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isTemplateSpan(parent))) {
    parent = parent.parent;
  }
  return Boolean(parent && isCompositionNode(parent));
}

function addCompositionDelta(inventory, relativePath, parts, context) {
  if (!parts || parts.length < 2) return;
  const composed = parts.join("");
  for (const [family, definition] of Object.entries(FAMILIES)) {
    const scoped = scopedDefinition(family, definition, relativePath);
    const composedCount = familyMatchCount(composed, scoped);
    const fragmentCount = parts.reduce(
      (total, part) => total + familyMatchCount(part, scoped),
      0,
    );
    const delta = composedCount - fragmentCount;
    if (delta > 0) {
      addMatch(inventory, family, relativePath, "string", delta, composed, context);
    }
  }
}

function staticJsxParts(node) {
  if (ts.isJsxText(node)) return [node.text];
  if (ts.isJsxExpression(node)) {
    if (!node.expression) return [];
    const parts = constantStringParts(node.expression);
    return parts ? [parts.join("")] : null;
  }
  if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
    const parts = [];
    for (const child of node.children) {
      const childParts = staticJsxParts(child);
      if (!childParts) return null;
      parts.push(...childParts);
    }
    return parts;
  }
  if (ts.isJsxSelfClosingElement(node)) return [];
  return null;
}

function hasJsxTextAncestor(node) {
  let parent = node.parent;
  while (parent) {
    if (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) return true;
    if (!ts.isJsxExpression(parent)) return false;
    parent = parent.parent;
  }
  return false;
}

function inspectCompositions(inventory, relativePath, node, sourceFile) {
  if (isCompositionNode(node) && !hasCompositionAncestor(node)) {
    addCompositionDelta(
      inventory,
      relativePath,
      constantStringParts(node),
      syntaxContext(node, sourceFile),
    );
  }
  if (
    (ts.isJsxElement(node) || ts.isJsxFragment(node)) &&
    !hasJsxTextAncestor(node)
  ) {
    addCompositionDelta(
      inventory,
      relativePath,
      staticJsxParts(node),
      syntaxContext(node, sourceFile),
    );
  }
}

function inventoryForTypeScriptSource(relativePath, source) {
  const inventory = {};
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node) {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      inspectValue(
        inventory,
        relativePath,
        node.text,
        "identifier",
        syntaxContext(node, sourceFile),
      );
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      inspectValue(
        inventory,
        relativePath,
        node.text,
        "string",
        syntaxContext(node, sourceFile),
      );
    }
    inspectCompositions(inventory, relativePath, node, sourceFile);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return inventory;
}

function consumeBlockComment(source, start) {
  let depth = 1;
  let cursor = start + 2;
  while (cursor < source.length && depth > 0) {
    if (source.startsWith("/*", cursor)) {
      depth += 1;
      cursor += 2;
    } else if (source.startsWith("*/", cursor)) {
      depth -= 1;
      cursor += 2;
    } else {
      cursor += 1;
    }
  }
  return cursor;
}

function consumeQuoted(source, start, quote, doubledQuoteEscape = false) {
  let cursor = start + 1;
  let value = "";
  while (cursor < source.length) {
    if (source[cursor] === quote) {
      if (doubledQuoteEscape && source[cursor + 1] === quote) {
        value += quote;
        cursor += 2;
        continue;
      }
      return { cursor: cursor + 1, value };
    }
    if (!doubledQuoteEscape && source[cursor] === "\\") {
      value += source[cursor + 1] ?? "";
      cursor += 2;
      continue;
    }
    value += source[cursor];
    cursor += 1;
  }
  return { cursor, value };
}

function lexicalContext(source, cursor) {
  const lineStart = source.lastIndexOf("\n", cursor - 1) + 1;
  const lineEnd = source.indexOf("\n", cursor);
  return source
    .slice(lineStart, lineEnd === -1 ? source.length : lineEnd)
    .trim()
    .replace(/\s+/g, " ");
}

function inventoryForRustSource(relativePath, source) {
  const inventory = {};
  let cursor = 0;
  while (cursor < source.length) {
    if (source.startsWith("//", cursor)) {
      cursor = source.indexOf("\n", cursor + 2);
      if (cursor === -1) break;
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      cursor = consumeBlockComment(source, cursor);
      continue;
    }

    const raw = /^(?:br|cr|r)(#*)"/.exec(source.slice(cursor));
    if (raw && (cursor === 0 || !/[A-Za-z0-9_]/.test(source[cursor - 1] ?? ""))) {
      const hashes = raw[1] ?? "";
      const contentStart = cursor + raw[0].length;
      const terminator = `"${hashes}`;
      const contentEnd = source.indexOf(terminator, contentStart);
      const value = contentEnd === -1 ? source.slice(contentStart) : source.slice(contentStart, contentEnd);
      inspectValue(inventory, relativePath, value, "string", lexicalContext(source, cursor));
      cursor = contentEnd === -1 ? source.length : contentEnd + terminator.length;
      continue;
    }

    const quoteOffset =
      source[cursor] === '"'
        ? 0
        : ["b", "c"].includes(source[cursor] ?? "") && source[cursor + 1] === '"'
          ? 1
          : -1;
    if (quoteOffset >= 0) {
      const quoted = consumeQuoted(source, cursor + quoteOffset, '"');
      inspectValue(
        inventory,
        relativePath,
        quoted.value,
        "string",
        lexicalContext(source, cursor),
      );
      cursor = quoted.cursor;
      continue;
    }

    const charLiteral = /^'(?:\\.|[^\\'])'/.exec(source.slice(cursor));
    if (charLiteral) {
      cursor += charLiteral[0].length;
      continue;
    }

    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(cursor));
    if (identifier) {
      inspectValue(
        inventory,
        relativePath,
        identifier[0],
        "identifier",
        lexicalContext(source, cursor),
      );
      cursor += identifier[0].length;
      continue;
    }
    cursor += 1;
  }
  return inventory;
}

function inventoryForSqlSource(relativePath, source) {
  const inventory = {};
  let cursor = 0;
  while (cursor < source.length) {
    if (source.startsWith("--", cursor)) {
      cursor = source.indexOf("\n", cursor + 2);
      if (cursor === -1) break;
      continue;
    }
    if (source.startsWith("/*", cursor)) {
      cursor = consumeBlockComment(source, cursor);
      continue;
    }

    const dollarQuote = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(source.slice(cursor));
    if (dollarQuote) {
      const terminator = dollarQuote[0];
      const contentStart = cursor + terminator.length;
      const contentEnd = source.indexOf(terminator, contentStart);
      const value = contentEnd === -1 ? source.slice(contentStart) : source.slice(contentStart, contentEnd);
      inspectValue(inventory, relativePath, value, "string", lexicalContext(source, cursor));
      cursor = contentEnd === -1 ? source.length : contentEnd + terminator.length;
      continue;
    }

    if (source[cursor] === "'" || source[cursor] === '"') {
      const quote = source[cursor];
      const quoted = consumeQuoted(source, cursor, quote, true);
      inspectValue(
        inventory,
        relativePath,
        quoted.value,
        quote === "'" ? "string" : "identifier",
        lexicalContext(source, cursor),
      );
      cursor = quoted.cursor;
      continue;
    }

    const identifier = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(source.slice(cursor));
    if (identifier) {
      inspectValue(
        inventory,
        relativePath,
        identifier[0],
        "identifier",
        lexicalContext(source, cursor),
      );
      cursor += identifier[0].length;
      continue;
    }
    cursor += 1;
  }
  return inventory;
}

export function inventoryForSource(relativePath, source) {
  const extension = path.extname(relativePath);
  if (extension === ".rs") return inventoryForRustSource(relativePath, source);
  if (extension === ".sql") return inventoryForSqlSource(relativePath, source);
  if (TYPESCRIPT_EXTENSIONS.has(extension)) return inventoryForTypeScriptSource(relativePath, source);
  throw new Error(`Unsupported vocabulary source extension: ${extension}`);
}

async function buildInventory() {
  const inventory = {};
  const files = (
    await Promise.all(
      SOURCE_ROOTS.map(async (sourceRoot) => {
        const absolute = path.join(PLATFORM_ROOT, sourceRoot);
        try {
          return await collectFiles(absolute);
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
          throw error;
        }
      }),
    )
  ).flat();

  for (const file of files.sort((left, right) => left.relative.localeCompare(right.relative))) {
    const fileInventory = inventoryForSource(file.relative, await readFile(file.absolute, "utf8"));
    for (const [family, filesByFamily] of Object.entries(fileInventory)) {
      inventory[family] ??= {};
      Object.assign(inventory[family], filesByFamily);
    }
  }

  return Object.fromEntries(
    Object.entries(inventory)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([family, filesByFamily]) => [
        family,
        Object.fromEntries(Object.entries(filesByFamily).sort(([left], [right]) => left.localeCompare(right))),
      ]),
  );
}

function totalOccurrences(inventory) {
  return Object.values(inventory).reduce(
    (familyTotal, files) =>
      familyTotal +
      Object.values(files).reduce(
        (fileTotal, counts) => fileTotal + counts.identifier + counts.string,
        0,
      ),
    0,
  );
}

function fingerprintCounts(counts, kind) {
  return counts?.fingerprints?.[kind] ?? {};
}

export function compareInventories(current, baseline) {
  const introduced = [];
  const removed = [];
  const families = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const family of families) {
    const currentFiles = current[family] ?? {};
    const baselineFiles = baseline[family] ?? {};
    const files = new Set([...Object.keys(currentFiles), ...Object.keys(baselineFiles)]);
    for (const relativePath of files) {
      const currentCounts = currentFiles[relativePath] ?? emptyCount();
      const baselineCounts = baselineFiles[relativePath] ?? emptyCount();
      for (const kind of ["identifier", "string"]) {
        const currentFingerprints = fingerprintCounts(currentCounts, kind);
        const baselineFingerprints = fingerprintCounts(baselineCounts, kind);
        const fingerprints = new Set([
          ...Object.keys(currentFingerprints),
          ...Object.keys(baselineFingerprints),
        ]);
        for (const fingerprint of fingerprints) {
          const currentCount = currentFingerprints[fingerprint] ?? 0;
          const baselineCount = baselineFingerprints[fingerprint] ?? 0;
          const detail = {
            family,
            relativePath,
            kind,
            fingerprint,
            currentCount,
            baselineCount,
          };
          if (currentCount > baselineCount) introduced.push(detail);
          if (currentCount < baselineCount) removed.push(detail);
        }
      }
    }
  }
  return { introduced, removed };
}

function formatChange(change) {
  return `${change.relativePath}: ${change.family} ${change.kind} fingerprint ${change.fingerprint} changed from ${change.baselineCount} to ${change.currentCount}`;
}

function isCurrentBaseline(baseline) {
  return baseline?.version === 3 && baseline.families && typeof baseline.families === "object";
}

async function main() {
  const inventory = await buildInventory();
  const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
  if (process.argv.includes("--write-baseline")) {
    if (isCurrentBaseline(baseline)) {
      const { introduced } = compareInventories(inventory, baseline.families);
      if (introduced.length > 0) {
        console.error("Refusing to grow the retired-vocabulary baseline:");
        for (const change of introduced) console.error(`- ${formatChange(change)}`);
        process.exitCode = 1;
        return;
      }
    } else if (
      !(
        (baseline.version === 1 && process.argv.includes("--upgrade-v1-baseline")) ||
        (baseline.version === 2 && process.argv.includes("--upgrade-v2-baseline"))
      )
    ) {
      throw new Error(
        "Unsupported retired-vocabulary baseline format; an older version requires its one-time upgrade flag",
      );
    }
    await writeFile(BASELINE_PATH, `${JSON.stringify({ version: 3, families: inventory }, null, 2)}\n`);
    console.log(`Wrote ${totalOccurrences(inventory)} retired-vocabulary occurrences to ${BASELINE_PATH}`);
    return;
  }

  if (!isCurrentBaseline(baseline)) {
    throw new Error("Unsupported retired-vocabulary baseline format");
  }

  const { introduced, removed } = compareInventories(inventory, baseline.families);

  if (introduced.length > 0) {
    console.error("check:vocabulary found new retired product/code vocabulary:");
    for (const change of introduced) console.error(`- ${formatChange(change)}`);
    console.error("Migrate the identifier/copy, or add a reviewed compatibility adapter to the explicit allowlist.");
    process.exitCode = 1;
    return;
  }
  if (removed.length > 0) {
    console.error("check:vocabulary found retired vocabulary removals with a stale baseline:");
    for (const change of removed) console.error(`- ${formatChange(change)}`);
    console.error("Run `node scripts/check-retired-vocabulary.mjs --write-baseline` to ratchet the reviewed baseline downward.");
    process.exitCode = 1;
    return;
  }

  console.log(
    `check:vocabulary: OK - ${totalOccurrences(inventory)} grandfathered occurrences remain and the fingerprint baseline matches`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) await main();
