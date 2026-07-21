import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { Navigate, useLocation } from "react-router";
import { trpc } from "../lib/trpc";
import {
  SUPABASE_CONFIGURATION_ERROR,
  SUPABASE_CONFIGURED,
  supabase,
} from "../lib/supabase";

type AuthStatus =
  | "local"
  | "loading"
  | "anonymous"
  | "activating"
  | "authenticated"
  | "error";

interface AuthSessionValue {
  configured: boolean;
  status: AuthStatus;
  session: Session | null;
  error: string | null;
  signOut(): Promise<void>;
}

const AuthSessionContext = createContext<AuthSessionValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(
    SUPABASE_CONFIGURED ? "loading" : "local",
  );
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(
    SUPABASE_CONFIGURATION_ERROR,
  );
  const generation = useRef(0);

  const applySession = useCallback(async (next: Session | null) => {
    const currentGeneration = ++generation.current;
    setSession(next);
    setError(null);
    if (!next) {
      setStatus("anonymous");
      return;
    }
    setStatus("activating");
    try {
      await trpc.organization.activateSession.mutate();
      if (generation.current === currentGeneration) {
        setStatus("authenticated");
      }
    } catch (failure) {
      if (generation.current === currentGeneration) {
        setStatus("error");
        setError(
          failure instanceof Error
            ? failure.message
            : "This account could not activate the pilot Organization",
        );
      }
    }
  }, []);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    let active = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) {
        setStatus("error");
        setError(sessionError.message);
        return;
      }
      void applySession(data.session);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (active) void applySession(next);
    });
    return () => {
      active = false;
      generation.current += 1;
      subscription.unsubscribe();
    };
  }, [applySession]);

  const signOut = useCallback(async () => {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw signOutError;
    generation.current += 1;
    setSession(null);
    setError(null);
    setStatus(SUPABASE_CONFIGURED ? "anonymous" : "local");
  }, []);

  const value = useMemo<AuthSessionValue>(
    () => ({
      configured: SUPABASE_CONFIGURED,
      status,
      session,
      error,
      signOut,
    }),
    [error, session, signOut, status],
  );
  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSessionValue {
  const value = useContext(AuthSessionContext);
  if (!value) {
    throw new Error("useAuthSession must be used inside AuthSessionProvider");
  }
  return value;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuthSession();
  const location = useLocation();
  if (!auth.configured || auth.status === "local") return children;
  if (auth.status === "anonymous") {
    return (
      <Navigate
        to="/auth/sign-in"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  if (auth.status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--color-surface)] p-6">
        <section className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-background p-8 shadow-sm">
          <h1 className="text-xl font-semibold text-[var(--color-navy)]">
            Account not authorized
          </h1>
          <p className="mt-3 text-sm text-[var(--color-warm-gray)]">
            {auth.error ?? "This account cannot access the pilot Organization."}
          </p>
          <button
            type="button"
            className="mt-6 w-full rounded-lg bg-[var(--color-navy)] px-4 py-2.5 text-sm font-medium text-white"
            onClick={() => void auth.signOut()}
          >
            Sign out
          </button>
        </section>
      </main>
    );
  }
  if (auth.status !== "authenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--color-surface)]">
        <p className="text-sm text-[var(--color-warm-gray)]">
          Securing your session...
        </p>
      </main>
    );
  }
  return children;
}
