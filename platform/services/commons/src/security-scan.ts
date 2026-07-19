import {
  computePackageRisk,
  evaluateSandboxRequirement,
  type CommonsDependencyPin,
  type CommonsProvenance,
  type CommonsSecurityCheck,
  type CommonsSecurityScan,
  type PackageManifest,
} from "@bridge/core";

function check(id: string, status: CommonsSecurityCheck["status"], detail: string): CommonsSecurityCheck {
  return { id, status, detail };
}

type ResolvedPackageDependency = { manifest: PackageManifest; contentHash: string };
type ResolvePackageDependency = (manifestId: string, version: string) => ResolvedPackageDependency | undefined;

function resolveClosure(
  manifest: PackageManifest,
  resolveDependency: ResolvePackageDependency,
): { manifests: PackageManifest[]; pins: CommonsDependencyPin[]; unresolved: string[] } {
  const manifests = [manifest];
  const pins: CommonsDependencyPin[] = [];
  const unresolved: string[] = [];
  const visited = new Set([`${manifest.name}@${manifest.version}`]);
  function visit(current: PackageManifest): void {
    for (const dependency of current.dependencies) {
      const key = `${dependency.manifestId}@${dependency.version}`;
      const resolved = resolveDependency(dependency.manifestId, dependency.version);
      if (!resolved) {
        unresolved.push(key);
        continue;
      }
      if (visited.has(key)) continue;
      visited.add(key);
      pins.push({
        name: dependency.manifestId,
        version: dependency.version,
        contentHash: resolved.contentHash,
      });
      manifests.push(resolved.manifest);
      visit(resolved.manifest);
    }
  }

  visit(manifest);
  pins.sort((a, b) => {
    const left = `${a.name}@${a.version}`;
    const right = `${b.name}@${b.version}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return { manifests, pins, unresolved };
}

/** Deterministic CM1 publish gate over the normalized declarative artifact. */
export function scanCommonsPackage(
  manifest: PackageManifest,
  provenance: CommonsProvenance,
  privacyPaths: readonly string[],
  resolveDependency: ResolvePackageDependency = () => undefined,
): CommonsSecurityScan {
  const closure = resolveClosure(manifest, resolveDependency);
  const risk = computePackageRisk(manifest, () => undefined, (name, version) => resolveDependency(name, version)?.manifest);
  const unpinnedBlueprintCapabilities = manifest.blueprint?.capabilities ?? [];
  const sandboxFailures = closure.manifests.flatMap((item) => item.capabilities)
    .map((capability) => ({ capability, gate: evaluateSandboxRequirement(capability) }))
    .filter(({ gate }) => !gate.satisfied);

  const checks: CommonsSecurityCheck[] = [
    check("manifest-schema", "pass", "Capability manifest passed the canonical parser."),
    privacyPaths.length === 0
      ? check("generalized-content", "pass", "No Organization, user, credential, or personal-data indicators found.")
      : check("generalized-content", "fail", `Private-data paths: ${privacyPaths.join(", ")}`),
    /^https:\/\//.test(provenance.sourceRepository)
      ? check("source-repository", "pass", `Pinned source uses HTTPS: ${provenance.sourceRepository}`)
      : check("source-repository", "fail", "Source repository must be an HTTPS URL."),
    /^[0-9a-f]{40}$/i.test(provenance.inspectedCommit)
      ? check("inspected-commit", "pass", `Inspected commit ${provenance.inspectedCommit}.`)
      : check("inspected-commit", "fail", "Inspected commit must be a full 40-character Git SHA."),
    provenance.repositoryLicense === "NOASSERTION"
      ? check("repository-license", "warning", "Repository has no declared license; capability terms remain independently explicit.")
      : check("repository-license", "pass", `Repository license: ${provenance.repositoryLicense}.`),
    provenance.licenseVerified && provenance.artifactLicense !== "NOASSERTION"
      ? check("artifact-license", "pass", `Capability license verified: ${provenance.artifactLicense}.`)
      : check("artifact-license", "fail", "Capability license must be explicit and verified."),
    closure.unresolved.length > 0
      ? check("dependency-pins", "fail", `Unresolved exact capability dependencies: ${closure.unresolved.join(", ")}.`)
      : check(
          "dependency-pins",
          "pass",
          closure.pins.length === 0
            ? "No capability dependencies."
            : `${closure.pins.length} exact content-hash dependency pin(s) resolved and verified.`,
        ),
    unpinnedBlueprintCapabilities.length > 0
      ? check(
          "blueprint-capability-pins",
          "fail",
          `Organization Blueprint references lack exact signed capability pins: ${unpinnedBlueprintCapabilities.join(", ")}.`,
        )
      : check("blueprint-capability-pins", "pass", "No unpinned Organization Blueprint capability references."),
    sandboxFailures.length > 0
      ? check(
          "execution-policy",
          "fail",
          `Sandbox floor failed for: ${sandboxFailures.map(({ capability }) => capability.id).join(", ")}.`,
        )
      : risk.trifectaEscalated
        ? check("execution-policy", "fail", "Capability union forms the lethal trifecta.")
        : check("execution-policy", "pass", "Executable isolation and lethal-trifecta union checks passed."),
  ];

  return {
    scanner: "bridge-commons-manifest",
    scannerVersion: "1.0.0",
    policyVersion: "CM1-2026-07",
    status: checks.some((item) => item.status === "fail") ? "failed" : "passed",
    riskBand: risk.effectiveRisk,
    lethalTrifecta: risk.trifectaEscalated,
    dependencyPins: closure.pins,
    checks,
  };
}
