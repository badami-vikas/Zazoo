import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { PILOT_WORKSPACE, trpc } from "../lib/trpc";

export function InstalledModuleBoundary({
  packageName,
  children,
}: {
  packageName: string;
  children: ReactNode;
}) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInstalled(null);
    setError(null);
    trpc.packages.list
      .query({ workspaceId: PILOT_WORKSPACE, limit: 100, offset: 0 })
      .then((result) => {
        if (cancelled) return;
        setInstalled(
          result.items.some(
            (item) =>
              item.packageName === packageName &&
              item.state === "available" &&
              item.status === "installed",
          ),
        );
      })
      .catch((failure) => {
        if (!cancelled) setError(String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [packageName]);

  if (error) {
    return <div className="p-6 text-sm text-red-600">Could not verify installed Module: {error}</div>;
  }
  if (installed === null) {
    return <div className="p-6 text-sm text-muted-foreground">Verifying installed Module…</div>;
  }
  if (!installed) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        This Page is unavailable because its Module is not installed.{" "}
        <Link to="/settings" className="underline" style={{ color: "var(--color-steel)" }}>
          Open Settings
        </Link>
      </div>
    );
  }
  return children;
}
