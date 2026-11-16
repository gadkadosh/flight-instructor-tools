import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { withChatGPTState } from "./chatgpt-store.ts";
import type { Account, ChatGPTState, Credentials } from "./chatgpt-store.ts";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const scope =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const sharingScope = "chatgpt.tokens.use.direct";
const random = () => randomBytes(32).toString("base64url");
export const chatGPTUsageUrl = "https://chatgpt.com/settings/usage";
export type ChatGPTModel = { slug: string; displayName: string };

export class ChatGPTError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

// Whitelist fields shown in React. Never serialize an account's token record.
function publicAccount(account: Account) {
  return {
    id: account.id,
    email: account.email,
    model: account.model,
    connected: !!account.credentials,
    sharing: !!account.credentials?.scopes.includes(sharingScope),
  };
}

export class ChatGPT {
  private keys?: ReturnType<typeof createRemoteJWKSet>;
  readonly directory: string;
  private readonly request: typeof fetch;
  constructor(
    directory = resolve("local/chatgpt"),
    request: typeof fetch = fetch,
  ) {
    this.directory = directory;
    this.request = request;
  }
  private state<T>(
    fn: (state: ChatGPTState, save: () => Promise<void>) => Promise<T>,
  ) {
    return withChatGPTState(this.directory, fn);
  }
  async settings() {
    return this.state(async (state) => ({
      provider: state.provider,
      welcomed: !!state.welcomed,
      accounts: state.accounts.map(publicAccount),
      activeId: state.activeId,
    }));
  }
  async configure(
    provider: "ollama" | "chatgpt",
    accountId?: string,
    model?: string,
  ) {
    if (model && !(await this.models()).some((m) => m.slug === model))
      throw new Error("Choose a model available to this ChatGPT account.");
    return this.state(async (state) => {
      if (accountId && !state.accounts.some((a) => a.id === accountId))
        throw new Error("Unknown ChatGPT account.");
      if (model) {
        if (accountId !== state.activeId)
          throw new Error("The ChatGPT account changed. Reload its models.");
        state.accounts.find((a) => a.id === state.activeId)!.model = model;
      }
      if (accountId) state.activeId = accountId;
      state.provider = provider;
    });
  }
  async welcome() {
    await this.state(async (state) => {
      state.welcomed = true;
    });
  }

  async startSignIn(origin: string, accountId?: string) {
    const url = new URL(origin);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.origin !== origin
    )
      throw new Error(
        "Open this app at http://127.0.0.1:<port> before connecting ChatGPT.",
      );
    return this.state(async (state) => {
      const account = state.accounts.find((a) => a.id === accountId);
      if (accountId && !account) throw new Error("Unknown ChatGPT account.");
      const pending = {
        state: random(),
        nonce: random(),
        verifier: random(),
        redirectUri: `${origin}/auth/callback`,
        expiresAt: Date.now() + 10 * 60_000,
        accountId,
      };
      state.pending = pending;
      const authorize = new URL(`${issuer}/api/accounts/authorize`);
      authorize.search = new URLSearchParams({
        client_id: account?.clientId ?? "dynamic_agent_client",
        ...(account ? {} : { agent_name_hint: "Flight Instructor Tools" }),
        ext_agent_host_id: state.hostId,
        response_type: "code",
        redirect_uri: pending.redirectUri,
        scope,
        resource,
        state: pending.state,
        nonce: pending.nonce,
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(pending.verifier)
          .digest("base64url"),
        ...(account?.email ? { login_hint: account.email } : {}),
        // The reconnect button explicitly asks to enable plan usage again.
        ...(account?.credentials &&
        !account.credentials.scopes.includes(sharingScope)
          ? { prompt: "consent" }
          : {}),
      }).toString();
      return { url: authorize.toString(), state: pending.state };
    });
  }

  async finishSignIn(callback: URL, cookieState: string | undefined) {
    return this.state(async (state, save) => {
      const pending = state.pending;
      if (!pending || pending.expiresAt < Date.now())
        throw new Error("Sign-in expired. Start again from ChatGPT settings.");
      if (!cookieState)
        throw new Error(
          "The sign-in browser cookie is missing. Start and finish sign-in in the same browser at 127.0.0.1.",
        );
      if (
        cookieState !== pending.state ||
        callback.searchParams.get("state") !== pending.state
      )
        throw new Error(
          "Sign-in could not be verified: a newer sign-in attempt replaced this one. Start again from ChatGPT settings.",
        );
      if (`${callback.origin}${callback.pathname}` !== pending.redirectUri)
        throw new Error(
          `The sign-in callback address did not match (${callback.origin}${callback.pathname}). Start again from ChatGPT settings.`,
        );
      delete state.pending;
      if (callback.searchParams.has("error"))
        throw new Error(
          "ChatGPT sign-in was declined. Your existing connection was kept.",
        );
      const previous = state.accounts.find((a) => a.id === pending.accountId);
      const issued = callback.searchParams.get("client_id");
      const clientId = issued || previous?.clientId;
      const code = callback.searchParams.get("code");
      if (
        !code ||
        !clientId ||
        clientId === "dynamic_agent_client" ||
        (previous && clientId !== previous.clientId)
      )
        throw new Error(
          "ChatGPT returned an incomplete or mismatched registration. Try signing in again.",
        );
      const account: Account = previous ?? { id: randomUUID(), clientId };
      if (!previous) state.accounts.push(account);
      // Preserve the issued registration before spending its one-time code.
      await save();
      const data = await this.token(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          code,
          code_verifier: pending.verifier,
          redirect_uri: pending.redirectUri,
          resource,
        }),
      );
      const credentials = this.credentials(data);
      const identity = await this.verify(
        credentials.idToken,
        account,
        pending.nonce,
      );
      Object.assign(account, identity, { credentials });
      delete account.rotation;
      state.activeId = account.id;
      state.provider = "chatgpt";
    });
  }

  private async json(url: string, init?: RequestInit) {
    const response = await this.request(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = data.error;
      const code = typeof error === "string" ? error : error?.code;
      const message =
        typeof data.detail === "string"
          ? data.detail
          : (error?.message ??
            data.error_description ??
            "ChatGPT request failed.");
      throw new ChatGPTError(
        `ChatGPT HTTP ${response.status}: ${String(message).slice(0, 400)}${code ? ` (${code})` : ""}${response.headers.get("x-request-id") ? ` · Request ${response.headers.get("x-request-id")}` : ""}`,
        code,
      );
    }
    return data;
  }
  private token(body: URLSearchParams) {
    return this.json(`${issuer}/api/accounts/oauth/token`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }
  private credentials(
    data: Record<string, unknown>,
    previous?: Credentials,
  ): Credentials {
    if (
      typeof data.access_token !== "string" ||
      !data.access_token ||
      typeof data.id_token !== "string" ||
      typeof data.scope !== "string" ||
      typeof data.expires_in !== "number" ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0 ||
      typeof data.token_type !== "string" ||
      data.token_type.toLowerCase() !== "bearer"
    )
      throw new Error(
        "ChatGPT returned incomplete credentials. Reconnect your account.",
      );
    const refreshToken =
      typeof data.refresh_token === "string"
        ? data.refresh_token
        : previous?.refreshToken;
    const scopes = data.scope.split(/\s+/);
    if (scopes.includes("offline_access") && !refreshToken)
      throw new Error(
        "ChatGPT did not return renewable access. Reconnect your account.",
      );
    const earliest =
      typeof data.earliest_refresh_at === "number"
        ? data.earliest_refresh_at * 1000
        : typeof data.earliest_refresh_at === "string"
          ? Date.parse(data.earliest_refresh_at)
          : undefined;
    return {
      accessToken: data.access_token,
      idToken: data.id_token,
      scopes,
      refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      earliestRefreshAt: earliest,
    };
  }
  private async verify(
    token: string,
    account: Account,
    nonce?: string,
    receivedAt?: number,
  ) {
    if (!this.keys) {
      const discovery = await this.json(
        `${issuer}/.well-known/openid-configuration`,
      );
      if (
        discovery.issuer !== issuer ||
        new URL(discovery.jwks_uri).origin !== issuer
      )
        throw new Error(
          "ChatGPT identity configuration could not be verified.",
        );
      this.keys = createRemoteJWKSet(new URL(discovery.jwks_uri), {
        [customFetch]: this.request,
        timeoutDuration: 15_000,
      });
    }
    const { payload } = await jwtVerify(token, this.keys, {
      issuer,
      audience: account.clientId,
      algorithms: ["RS256"],
      clockTolerance: 5,
      requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
      ...(receivedAt ? { currentDate: new Date(receivedAt) } : {}),
    });
    if (
      !payload.sub ||
      (account.subject && account.subject !== payload.sub) ||
      (nonce && payload.nonce !== nonce) ||
      (payload.azp !== undefined && payload.azp !== account.clientId) ||
      (Array.isArray(payload.aud) &&
        payload.aud.length > 1 &&
        payload.azp !== account.clientId)
    )
      throw new Error(
        "ChatGPT returned a different or unverifiable account. Reconnect the intended account.",
      );
    return {
      subject: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  }

  async access() {
    return this.state(async (state, save) => {
      const account = state.accounts.find((a) => a.id === state.activeId);
      if (!account?.credentials)
        throw new Error("Connect your ChatGPT account in settings first.");
      if (account.rotation) {
        await this.verify(
          account.rotation.credentials.idToken,
          account,
          undefined,
          account.rotation.receivedAt,
        );
        account.credentials = account.rotation.credentials;
        delete account.rotation;
        await save();
      }
      let credentials = account.credentials;
      if (!credentials.scopes.includes(sharingScope))
        throw new Error(
          "ChatGPT plan usage is disabled. Enable it in ChatGPT settings, then reconnect.",
        );
      if (credentials.expiresAt <= Date.now() + 60_000) {
        if (
          credentials.earliestRefreshAt &&
          credentials.earliestRefreshAt > Date.now()
        ) {
          if (credentials.expiresAt <= Date.now())
            throw new Error(
              "ChatGPT access cannot refresh yet. Try again shortly.",
            );
        } else {
          if (!credentials.refreshToken)
            throw new Error("ChatGPT access expired. Reconnect your account.");
          try {
            const data = await this.token(
              new URLSearchParams({
                grant_type: "refresh_token",
                client_id: account.clientId,
                refresh_token: credentials.refreshToken,
                resource,
              }),
            );
            const next = this.credentials(data, credentials);
            account.rotation = { credentials: next, receivedAt: Date.now() };
            await save();
            await this.verify(next.idToken, account);
            account.credentials = credentials = next;
            delete account.rotation;
          } catch (error) {
            if (
              error instanceof ChatGPTError &&
              [
                "invalid_grant",
                "invalid_refresh_token",
                "token_expired",
                "refresh_token_expired",
                "refresh_token_invalidated",
                "refresh_token_reused",
              ].includes(error.code ?? "")
            ) {
              delete account.credentials;
              delete account.rotation;
            }
            throw error;
          }
        }
      }
      if (!credentials.scopes.includes(sharingScope))
        throw new Error(
          "ChatGPT plan usage is disabled. Reconnect your account.",
        );
      return {
        token: credentials.accessToken,
        model: account.model,
        accountId: account.id,
      };
    });
  }
  async models(): Promise<ChatGPTModel[]> {
    const { token } = await this.access();
    const data = await this.json(`${resource}/models`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!Array.isArray(data.models))
      throw new Error("ChatGPT returned an unsupported model list.");
    return data.models
      .filter(
        (m: { visibility: string; slug: unknown; display_name: unknown }) =>
          m.visibility === "list" &&
          typeof m.slug === "string" &&
          typeof m.display_name === "string",
      )
      .map((m: { slug: string; display_name: string }) => ({
        slug: m.slug,
        displayName: m.display_name,
      }));
  }
  async disconnect() {
    return this.state(async (state) => {
      delete state.pending;
      const account = state.accounts.find((a) => a.id === state.activeId);
      if (!account) return;
      const refreshToken =
        account.rotation?.credentials.refreshToken ??
        account.credentials?.refreshToken;
      try {
        if (refreshToken) {
          const config = await this.json(
            `${issuer}/.well-known/openid-configuration`,
          );
          if (new URL(config.revocation_endpoint).origin !== issuer)
            throw new Error("Invalid revocation endpoint.");
          const response = await this.request(config.revocation_endpoint, {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
            body: new URLSearchParams({
              token: refreshToken,
              token_type_hint: "refresh_token",
              client_id: account.clientId,
            }),
          });
          if (!response.ok) throw new Error("Revocation failed.");
        }
      } catch {
        throw new Error(
          "Local credentials removed; remote disconnection could not be confirmed. Disconnect this app in ChatGPT settings.",
        );
      } finally {
        delete account.credentials;
        delete account.rotation;
      }
    });
  }
}

export const chatGPT = new ChatGPT();
