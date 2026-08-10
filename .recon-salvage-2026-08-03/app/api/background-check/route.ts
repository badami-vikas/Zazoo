import { NextRequest, NextResponse } from 'next/server';
import {
  buildReport,
  buildReportFromRows,
  createCtx,
  getMissingEnricherKeys,
  runEnrichersForKeys,
  type Identity,
  type ReconInput,
} from '@/lib/recon';
import { reportToRows, appendStaging, storeStatus, getRowsForSubject, subjectKeyOf } from '@/lib/store';

// Phase 2 of the internal API: given a verified identity (the candidate the human
// picked in /api/resolve) plus the original input, run all enrichers and return a
// detailed background report.
//
// Cache behaviour: if the subject already has rows in permanent or staging storage,
// we return those immediately (no network calls). If new enrichers have been added
// since the last run (detected by missing source labels), only the new enrichers
// are run and their results are appended.
export async function POST(req: NextRequest) {
  let body: { identity?: Identity; input?: ReconInput };
  try {
    body = (await req.json()) as { identity?: Identity; input?: ReconInput };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.identity || !body.identity.displayName) {
    return NextResponse.json({ error: 'A verified identity (from /api/resolve) is required.' }, { status: 400 });
  }

  const identity = body.identity;
  const input = body.input ?? {};

  try {
    const subjectKey = subjectKeyOf(identity.identifiers.name || identity.displayName);
    const existingRows = await getRowsForSubject(subjectKey);

    if (existingRows.length > 0) {
      const coveredSources = new Set(existingRows.map((r) => r.source));
      const missingKeys = getMissingEnricherKeys(coveredSources);

      if (missingKeys.length === 0) {
        // Fully cached — reconstruct report from existing rows, no network calls.
        const report = buildReportFromRows(existingRows, identity);
        const store = await storeStatus();
        return NextResponse.json({ ...report, store, cached: true });
      }

      // Partial refresh — only run enrichers whose source labels are absent.
      const ctx = createCtx(identity, input);
      const newContribs = await runEnrichersForKeys(missingKeys, ctx);
      const newFields = newContribs.flatMap((c) => [
        ...c.personFields.map((f) => ({ scope: 'person' as const, f })),
        ...c.companyFields.map((f) => ({ scope: 'company' as const, f })),
        ...c.signals.map((f) => ({ scope: 'signal' as const, f })),
      ]);

      if (newFields.length > 0) {
        // Build a minimal report from just the new contributions to get new rows.
        const partialReport = buildReportFromRows(
          newFields.map(({ scope, f }, i) => ({
            id: `partial:${Date.now()}:${i}`,
            reportId: `partial:${Date.now()}`,
            subjectName: identity.displayName,
            subjectKey,
            subjectKind: identity.kind,
            scope,
            label: f.label,
            value: f.value,
            tier: f.tier,
            source: f.source,
            url: f.url,
            discoveredAt: new Date().toISOString(),
            eid: '?',
            confidence: 0,
            verificationState: 'found' as const,
          })),
          identity,
        );
        const newRows = reportToRows(partialReport);
        await appendStaging(newRows);
        // Return merged view: cached + newly appended
        const allRows = await getRowsForSubject(subjectKey);
        const report = buildReportFromRows(allRows, identity);
        const store = await storeStatus();
        return NextResponse.json({ ...report, store, partialRefresh: true, newSources: missingKeys });
      }

      // New enrichers returned nothing — still serve from cache.
      const report = buildReportFromRows(existingRows, identity);
      const store = await storeStatus();
      return NextResponse.json({ ...report, store, cached: true });
    }

    // No existing rows — full run.
    const report = await buildReport(identity, input);
    const store = await appendStaging(reportToRows(report));
    return NextResponse.json({ ...report, store });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'background-check failed' }, { status: 502 });
  }
}
