import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ShoppingCart, Boxes } from "lucide-react";
import { defaultViewConfig, type TableSpec, type ViewConfig } from "@bridge/tables";
import { trpc, PILOT_ORGANIZATION } from "../lib/trpc";
import { Header } from "../components/shared/Header";
import { ModuleIntelligenceSection } from "../components/shared/ModuleIntelligenceSection";
import { ModuleGovernanceSection } from "../components/shared/ModuleGovernanceSection";
import { ModuleSurfaceLayout } from "../components/shared/ModuleSurfaceLayout";
import { DashboardRow } from "../components/shared/DashboardRow";
import { InstalledModuleBoundary } from "../components/InstalledModuleBoundary";
import { DataViews } from "../dataviews/DataViews";
import type { DataRow } from "../dataviews/types";

/**
 * D2C — Orders and Inventory, the two toggle Pages of the parent Module
 * (manifest comment: same commerce domain, different data shapes — AP-011).
 * Real, possibly-empty data from `ctx.wiring.d2cDb` (the imported CV Naturals
 * sqlite, ADR-246). GST invoicing/WhatsApp capture/costing stay out of this
 * pass — TASK-074's bar is real persistence rendering, not feature parity.
 */
type D2CPageId = "orders" | "inventory";
type OrderRow = Awaited<ReturnType<typeof trpc.d2c.ordersList.query>>["items"][number];
type BatchRow = Awaited<ReturnType<typeof trpc.d2c.inventoryList.query>>["items"][number];

const TAB_ROUTE: Record<string, string> = {
  Orders: "/module/d2c/orders",
  Inventory: "/module/d2c/inventory",
};

export function D2CPage({ page }: { page: D2CPageId }) {
  const navigate = useNavigate();
  const [spec, setSpec] = useState<TableSpec | null>(null);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [batches, setBatches] = useState<BatchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewConfig>(() => defaultViewConfig(`d2c.${page}:table`));

  const load = useCallback(async () => {
    try {
      if (page === "orders") {
        const [definition, list] = await Promise.all([
          trpc.d2c.ordersDefinition.query({ organizationId: PILOT_ORGANIZATION }),
          trpc.d2c.ordersList.query({ organizationId: PILOT_ORGANIZATION }),
        ]);
        setSpec(definition as TableSpec);
        setOrders(list.items);
      } else {
        const [definition, list] = await Promise.all([
          trpc.d2c.inventoryDefinition.query({ organizationId: PILOT_ORGANIZATION }),
          trpc.d2c.inventoryList.query({ organizationId: PILOT_ORGANIZATION }),
        ]);
        setSpec(definition as TableSpec);
        setBatches(list.items);
      }
    } catch (failure) {
      setError(String(failure));
    }
  }, [page]);

  useEffect(() => {
    setSpec(null);
    setView(defaultViewConfig(`d2c.${page}:table`));
    void load();
  }, [page, load]);

  const rows = useMemo<DataRow[]>(() => {
    if (page === "orders") {
      return (orders ?? []).map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        customerName: o.customerName,
        source: o.source,
        status: o.status,
        placedAt: o.placedAt,
        transportCharge: o.transportCharge,
        discountAmount: o.discountAmount,
      }));
    }
    return (batches ?? []).map((b) => ({
      id: b.id,
      itemType: b.itemType,
      itemId: b.itemId,
      batchNo: b.batchNo,
      quantityOnHand: b.quantityOnHand,
      unitCost: b.unitCost,
      mfgDate: b.mfgDate,
      expiryDate: b.expiryDate,
    }));
  }, [page, orders, batches]);

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>;

  return (
    <InstalledModuleBoundary moduleName="d2c">
      <div className="flex h-full flex-1 flex-col overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
        <Header
          tabs={[
            { id: "Orders", icon: ShoppingCart },
            { id: "Inventory", icon: Boxes },
          ]}
          activeTab={page === "orders" ? "Orders" : "Inventory"}
          onTabChange={(id) => {
            const route = TAB_ROUTE[id];
            if (route) navigate(route);
          }}
        />
        {!spec ? (
          <div className="p-6 text-sm text-muted-foreground">Loading {page}…</div>
        ) : (
          <ModuleSurfaceLayout
            table={
              <section aria-label={`D2C ${page}`} className="h-full">
                <DataViews
                  spec={spec}
                  view={view}
                  data={rows}
                  searchPlaceholder={page === "orders" ? "Search orders…" : "Search stock batches…"}
                  insertDisabledReason={
                    page === "orders"
                      ? "Orders arrive from WhatsApp capture or manual entry, not implemented in this pass."
                      : "Stock batches are created from a purchase or a production run, not implemented in this pass."
                  }
                  onViewChange={setView}
                  insights={
                    <DashboardRow
                      metrics={
                        page === "orders"
                          ? [{ id: "orders", label: "Orders", value: String(orders?.length ?? 0) }]
                          : [{ id: "batches", label: "Batches", value: String(batches?.length ?? 0) }]
                      }
                    />
                  }
                />
              </section>
            }
            below={
              <>
                <ModuleIntelligenceSection moduleName="d2c" />
                <ModuleGovernanceSection moduleName="d2c" />
              </>
            }
          />
        )}
      </div>
    </InstalledModuleBoundary>
  );
}

export function D2COrdersPage() {
  return <D2CPage page="orders" />;
}

export function D2CInventoryPage() {
  return <D2CPage page="inventory" />;
}

export default D2CPage;
