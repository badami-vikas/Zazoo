import { useSyncExternalStore } from "react";
import {
  getApiRecoveryState,
  subscribeApiRecovery,
} from "../lib/api-transport";

export function ApiRecoveryBanner() {
  const state = useSyncExternalStore(
    subscribeApiRecovery,
    getApiRecoveryState,
    getApiRecoveryState,
  );
  if (state !== "waking" && state !== "unavailable") return null;

  return (
    <div
      className="fixed left-1/2 top-4 z-[200] -translate-x-1/2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-lg"
      role={state === "unavailable" ? "alert" : "status"}
    >
      {state === "waking"
        ? "Waking Bridge..."
        : "Bridge could not reconnect. Try again shortly."}
    </div>
  );
}
