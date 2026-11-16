import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { ChatGPT } from "../lib/chatgpt.ts";
import { withChatGPTState } from "../lib/chatgpt-store.ts";

async function connection() {
  const directory = await mkdtemp(join(tmpdir(), "fit-chatgpt-"));
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "synthetic-key",
    alg: "RS256",
  };
  const behavior = {
    nonce: "",
    subject: "synthetic-user",
    audience: "oaiapp_synthetic",
    scope:
      "openid email offline_access resource.invoke chatgpt.tokens.use.direct",
    expiresIn: 3600,
    refreshes: 0,
    exchanges: 0,
    revoked: false,
    failRefresh: false,
    failKeys: false,
  };
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/.well-known/openid-configuration"))
      return Response.json({
        issuer: "https://auth.openai.com",
        jwks_uri: "https://auth.openai.com/keys",
        revocation_endpoint: "https://auth.openai.com/revoke",
      });
    if (url.endsWith("/keys")) {
      if (behavior.failKeys)
        return new Response("temporarily offline", { status: 503 });
      return Response.json({ keys: [jwk] });
    }
    if (url.endsWith("/oauth/token")) {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("client_id"), "oaiapp_synthetic");
      assert.equal(body.get("resource"), "https://api.openai.com/v1");
      if (body.get("grant_type") === "refresh_token") {
        behavior.refreshes++;
        assert.equal(body.get("refresh_token"), "synthetic-refresh-0");
        if (behavior.failRefresh)
          return Response.json({ error: "invalid_grant" }, { status: 400 });
      } else {
        behavior.exchanges++;
        assert.equal(
          body.get("redirect_uri"),
          "http://127.0.0.1:3456/auth/callback",
        );
        assert.ok(body.get("code_verifier"));
      }
      const idToken = await new SignJWT({
        nonce: behavior.nonce,
        email: "synthetic@example.test",
      })
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
        .setSubject(behavior.subject)
        .setIssuer("https://auth.openai.com")
        .setAudience(behavior.audience)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
      return Response.json({
        access_token: `synthetic-access-${behavior.refreshes}`,
        refresh_token: `synthetic-refresh-${behavior.refreshes}`,
        id_token: idToken,
        scope: behavior.scope,
        token_type: "Bearer",
        expires_in: behavior.expiresIn,
      });
    }
    if (url.endsWith("/models"))
      return Response.json({
        models: [
          {
            slug: "synthetic-vision",
            display_name: "Synthetic Vision",
            visibility: "list",
          },
          { slug: "hidden", display_name: "Hidden", visibility: "hidden" },
        ],
      });
    if (url.endsWith("/revoke")) {
      behavior.revoked = true;
      return new Response(null, { status: 200 });
    }
    throw new Error(`Unexpected test request ${url}`);
  };
  const client = new ChatGPT(directory, request);
  async function begin(accountId?: string) {
    const start = await client.startSignIn("http://127.0.0.1:3456", accountId);
    const authorize = new URL(start.url);
    behavior.nonce = authorize.searchParams.get("nonce")!;
    const callback = new URL("http://127.0.0.1:3456/auth/callback");
    callback.search = new URLSearchParams({
      code: "synthetic-code",
      state: start.state,
      client_id: "oaiapp_synthetic",
    }).toString();
    return { start, authorize, callback };
  }
  return {
    client,
    request,
    directory,
    behavior,
    begin,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("subscription sign-in verifies identity, survives restart, exposes no tokens, and reuses registration after logout", async () => {
  const c = await connection();
  try {
    const { start, authorize, callback } = await c.begin();
    assert.equal(
      authorize.searchParams.get("client_id"),
      "dynamic_agent_client",
    );
    assert.match(
      authorize.searchParams.get("ext_agent_host_id")!,
      /^urn:uuid:/,
    );
    assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
    await c.client.finishSignIn(callback, start.state);
    const settings = await new ChatGPT(c.directory).settings();
    assert.equal(settings.accounts[0].email, "synthetic@example.test");
    assert.equal(settings.accounts[0].sharing, true);
    assert.equal(settings.provider, "chatgpt");
    assert.doesNotMatch(
      JSON.stringify(settings),
      /synthetic-access|synthetic-refresh|idToken|clientId/,
    );
    assert.equal(
      (await stat(join(c.directory, "connection.json"))).mode & 0o777,
      0o600,
    );
    assert.equal((await stat(c.directory)).mode & 0o777, 0o700);
    assert.deepEqual(await c.client.models(), [
      { slug: "synthetic-vision", displayName: "Synthetic Vision" },
    ]);
    await c.client.configure("chatgpt", settings.activeId, "synthetic-vision");
    assert.equal((await c.client.access()).model, "synthetic-vision");
    await c.client.disconnect();
    assert.ok(c.behavior.revoked);
    await assert.rejects(c.client.access(), /Connect your ChatGPT account/);
    const reconnect = await c.begin(settings.activeId);
    assert.equal(
      reconnect.authorize.searchParams.get("client_id"),
      "oaiapp_synthetic",
    );
    assert.equal(
      reconnect.authorize.searchParams.get("ext_agent_host_id"),
      authorize.searchParams.get("ext_agent_host_id"),
    );
    assert.doesNotMatch(
      await readFile(join(c.directory, "connection.json"), "utf8"),
      /synthetic-access|synthetic-refresh/,
    );
  } finally {
    await c.cleanup();
  }
});

test("wrong state, nonce, audience, and returning identity never authorize a model call", async () => {
  const c = await connection();
  try {
    const { start, callback } = await c.begin();
    await assert.rejects(
      c.client.finishSignIn(callback, "wrong-cookie"),
      /could not be verified/,
    );
    assert.equal(c.behavior.exchanges, 0);
    c.behavior.nonce = "wrong-nonce";
    await assert.rejects(
      c.client.finishSignIn(callback, start.state),
      /unverifiable/,
    );
    const pending = (await c.client.settings()).accounts[0];
    assert.equal(pending.connected, false);
    const badAudience = await c.begin(pending.id);
    c.behavior.audience = "another-app";
    await assert.rejects(
      c.client.finishSignIn(badAudience.callback, badAudience.start.state),
    );
    c.behavior.audience = "oaiapp_synthetic";
    const valid = await c.begin(pending.id);
    await c.client.finishSignIn(valid.callback, valid.start.state);
    await assert.rejects(
      c.client.finishSignIn(valid.callback, valid.start.state),
      /expired/,
    );
    const mismatch = await c.begin(pending.id);
    c.behavior.subject = "different-user";
    await assert.rejects(
      c.client.finishSignIn(mismatch.callback, mismatch.start.state),
      /different or unverifiable/,
    );
    assert.equal((await c.client.access()).token, "synthetic-access-0");
  } finally {
    await c.cleanup();
  }
});

test("identity sign-in without granted plan usage never starts inference", async () => {
  const c = await connection();
  try {
    c.behavior.scope = "openid email offline_access";
    const { start, callback } = await c.begin();
    await c.client.finishSignIn(callback, start.state);
    assert.equal((await c.client.settings()).accounts[0].connected, true);
    assert.equal((await c.client.settings()).accounts[0].sharing, false);
    await assert.rejects(c.client.models(), /plan usage is disabled/);
  } finally {
    await c.cleanup();
  }
});

test("concurrent clients serialize rotating refreshes and terminal expiry retains registration", async () => {
  const c = await connection();
  try {
    const { start, callback } = await c.begin();
    await c.client.finishSignIn(callback, start.state);
    const settings = await c.client.settings();
    await withChatGPTState(c.directory, async (state) => {
      state.accounts[0].credentials!.expiresAt = 1;
    });
    const another = new ChatGPT(c.directory, c.request);
    const results = await Promise.all([c.client.access(), another.access()]);
    assert.equal(c.behavior.refreshes, 1);
    assert.deepEqual(
      results.map((r) => r.token),
      ["synthetic-access-1", "synthetic-access-1"],
    );
    await withChatGPTState(c.directory, async (state) => {
      state.accounts[0].credentials!.expiresAt = 1;
      state.accounts[0].credentials!.refreshToken = "synthetic-refresh-0";
    });
    c.behavior.failRefresh = true;
    await assert.rejects(c.client.access(), /invalid_grant/);
    assert.equal((await c.client.settings()).accounts[0].connected, false);
    assert.equal((await c.client.settings()).activeId, settings.activeId);
  } finally {
    await c.cleanup();
  }
});

test("a refresh rotation survives temporary key-service failure and is recovered without reusing the old token", async () => {
  const c = await connection();
  try {
    const { start, callback } = await c.begin();
    await c.client.finishSignIn(callback, start.state);
    await withChatGPTState(c.directory, async (state) => {
      state.accounts[0].credentials!.expiresAt = 1;
    });
    const another = new ChatGPT(c.directory, c.request);
    c.behavior.failKeys = true;
    await assert.rejects(another.access());
    assert.equal(c.behavior.refreshes, 1);
    c.behavior.failKeys = false;
    assert.equal((await another.access()).token, "synthetic-access-1");
    assert.equal(c.behavior.refreshes, 1);
  } finally {
    await c.cleanup();
  }
});

test("authorization rejects non-loopback app origins", async () => {
  const c = await connection();
  try {
    for (const origin of [
      "https://example.com",
      "http://localhost:3000",
      "http://127.0.0.1:3000/path",
      "http://user:password@127.0.0.1:3000",
    ])
      await assert.rejects(c.client.startSignIn(origin), /127.0.0.1/);
  } finally {
    await c.cleanup();
  }
});
