import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { useAuthSession } from "./AuthSession";
import {
  SUPABASE_CONFIGURATION_ERROR,
  SUPABASE_CONFIGURED,
  supabase,
} from "../lib/supabase";

type AuthMode = "sign-in" | "sign-up" | "forgot-password" | "reset-password";

const copy: Record<AuthMode, { title: string; submit: string }> = {
  "sign-in": { title: "Sign in to Bridge", submit: "Sign in" },
  "sign-up": { title: "Create your Bridge account", submit: "Create account" },
  "forgot-password": {
    title: "Reset your password",
    submit: "Send reset link",
  },
  "reset-password": {
    title: "Choose a new password",
    submit: "Update password",
  },
};

export function AuthPage({ mode }: { mode: AuthMode }) {
  const auth = useAuthSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (
    mode !== "reset-password" &&
    auth.configured &&
    auth.status === "authenticated"
  ) {
    const from =
      typeof location.state === "object" &&
      location.state !== null &&
      "from" in location.state &&
      typeof location.state.from === "string"
        ? location.state.from
        : "/";
    return <Navigate to={from} replace />;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "sign-in") {
        const result = await supabase.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
      } else if (mode === "sign-up") {
        const result = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/sign-in`,
          },
        });
        if (result.error) throw result.error;
        setMessage(
          result.data.session
            ? "Account created. Securing your pilot session..."
            : "Check your email to confirm the account. The operator must approve its Supabase user ID before it can enter the pilot.",
        );
      } else if (mode === "forgot-password") {
        const result = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/reset-password`,
        });
        if (result.error) throw result.error;
        setMessage("If that account exists, a password reset link is on its way.");
      } else {
        const result = await supabase.auth.updateUser({ password });
        if (result.error) throw result.error;
        await auth.signOut();
        navigate("/auth/sign-in", { replace: true });
      }
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Authentication failed",
      );
    } finally {
      setPending(false);
    }
  }

  const needsEmail = mode !== "reset-password";
  const needsPassword = mode === "sign-in" || mode === "sign-up" || mode === "reset-password";
  const unavailable =
    SUPABASE_CONFIGURATION_ERROR ??
    (!SUPABASE_CONFIGURED
      ? "Supabase Auth is not configured for this build."
      : null);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-surface)] p-6">
      <section className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-background p-8 shadow-sm">
        <Link to="/" className="text-sm font-semibold text-[var(--color-navy-mid)] no-underline">
          Bridge
        </Link>
        <h1 className="mt-4 text-2xl font-semibold text-[var(--color-navy)]">
          {copy[mode].title}
        </h1>
        {unavailable ? (
          <p className="mt-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            {unavailable}
          </p>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={submit}>
            {needsEmail && (
              <label className="block text-sm font-medium text-[var(--color-navy-mid)]">
                Email
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-background px-3 py-2.5 outline-none focus:border-[var(--color-steel)]"
                />
              </label>
            )}
            {needsPassword && (
              <label className="block text-sm font-medium text-[var(--color-navy-mid)]">
                {mode === "reset-password" ? "New password" : "Password"}
                <input
                  type="password"
                  autoComplete={
                    mode === "sign-in" ? "current-password" : "new-password"
                  }
                  minLength={8}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-background px-3 py-2.5 outline-none focus:border-[var(--color-steel)]"
                />
              </label>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="text-sm text-[var(--color-navy-mid)]">
                {message}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-[var(--color-navy)] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {pending ? "Please wait..." : copy[mode].submit}
            </button>
          </form>
        )}
        <div className="mt-5 flex justify-between gap-4 text-sm">
          {mode === "sign-in" ? (
            <>
              <Link to="/auth/sign-up" className="text-[var(--color-navy-mid)]">
                Create account
              </Link>
              <Link to="/auth/forgot-password" className="text-[var(--color-navy-mid)]">
                Forgot password?
              </Link>
            </>
          ) : (
            <Link to="/auth/sign-in" className="text-[var(--color-navy-mid)]">
              Back to sign in
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
