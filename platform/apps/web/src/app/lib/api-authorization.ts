interface SessionReadResult {
  data: {
    session: {
      access_token: string;
    } | null;
  };
  error: {
    message: string;
  } | null;
}

interface ApiAuthorizationOptions {
  ensureReady(): Promise<void>;
  readSession?: () => Promise<SessionReadResult>;
  sidecarToken?: string;
}

export async function buildApiAuthorizationHeaders(
  options: ApiAuthorizationOptions,
): Promise<Record<string, string>> {
  // A hosted wake can consume the full Supabase refresh margin. Wake first so
  // getSession evaluates and, when needed, refreshes the token immediately before use.
  await options.ensureReady();

  let accessToken: string | undefined;
  if (options.readSession) {
    const { data, error } = await options.readSession();
    if (error) {
      throw new Error(
        `Could not read the authenticated Supabase session: ${error.message}`,
      );
    }
    accessToken = data.session?.access_token;
  }

  return {
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    ...(options.sidecarToken
      ? { "x-bridge-sidecar-token": options.sidecarToken }
      : {}),
  };
}
