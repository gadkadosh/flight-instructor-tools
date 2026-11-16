import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";
import { once } from "node:events";
import { createRequire } from "node:module";
import { png, sheetReading } from "./helpers.ts";
import { draftFromSheet } from "../lib/sheet.ts";
import { ChatGPT } from "../lib/chatgpt.ts";
import { withChatGPTState } from "../lib/chatgpt-store.ts";
import type { RecordSession, Student } from "../lib/record.ts";

// Exercise the built Next.js artifact over HTTP, using an isolated temporary data directory.
// Action IDs come from Next's build manifest, not hardcoded application internals.
test(
  "production upload → review → save → confirm → reopen, including duplicate uploads and protected originals",
  { timeout: 30000 },
  async () => {
    const root = resolve(".");
    const temp = mkdtempSync(join(tmpdir(), "flight-app-production-test-"));
    symlinkSync(join(root, ".next"), join(temp, ".next"), "dir");
    symlinkSync(join(root, "node_modules"), join(temp, "node_modules"), "dir");
    copyFileSync(join(root, "package.json"), join(temp, "package.json"));
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const address = socket.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    const base = `http://127.0.0.1:${port}`;
    let logs = "";
    function start() {
      const child = spawn(
        process.execPath,
        [
          join(root, "node_modules/next/dist/bin/next"),
          "start",
          temp,
          "-H",
          "127.0.0.1",
          "-p",
          String(port),
        ],
        {
          cwd: temp,
          env: {
            ...process.env,
            OLLAMA_MODEL: "",
            NEXT_TELEMETRY_DISABLED: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      child.stdout.on("data", (data) => {
        logs += data;
      });
      child.stderr.on("data", (data) => {
        logs += data;
      });
      return child;
    }
    let server = start();
    async function stop() {
      if (server.exitCode !== null || server.signalCode !== null) return;
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    async function waitForReady() {
      let ready = false;
      for (let i = 0; i < 80; i++) {
        try {
          const response = await fetch(base);
          if (response.ok) {
            ready = true;
            break;
          }
        } catch {
          /* Server is starting. */
        }
        if (server.exitCode !== null) break;
        await setTimeout(100);
      }
      assert.ok(ready, logs);
    }
    try {
      await waitForReady();
      const manifest = JSON.parse(
        readFileSync(
          join(root, ".next/server/server-reference-manifest.json"),
          "utf8",
        ),
      );
      async function action<T>(
        name: string,
        args: unknown[] | FormData,
        path = "/",
      ): Promise<T> {
        const entry = Object.entries(manifest.node).find(
          ([, value]) =>
            (value as { exportedName: string }).exportedName === name,
        );
        assert.ok(entry, `No built action for ${name}`);
        const headers: Record<string, string> = {
          "Next-Action": entry[0],
          Origin: base,
          Accept: "text/x-component",
        };
        if (!(args instanceof FormData))
          headers["Content-Type"] = "text/plain;charset=UTF-8";
        const response = await fetch(`${base}${path}`, {
          method: "POST",
          headers,
          body: args instanceof FormData ? args : JSON.stringify(args),
        });
        const text = await response.text();
        assert.equal(response.status, 200, text.slice(0, 1500) + logs);
        for (const line of text.split("\n")) {
          const match = /^[0-9a-f]+:(\{.*\})$/.exec(line);
          if (match) {
            const value = JSON.parse(match[1]);
            if (typeof value.ok === "boolean") return value as T;
            if (value.a && typeof value.a.ok === "boolean") return value.a as T;
          }
        }
        throw new Error(`No action result in ${text.slice(0, 1500)}`);
      }
      type Result<T> = { ok: true; value: T } | { ok: false; error: string };
      async function uploadBody() {
        const body = new FormData();
        body.set(
          "photos",
          new File([png], "explicit-synthetic-test.png", { type: "image/png" }),
        );
        const { encodeReply } = createRequire(import.meta.url)(
          "next/dist/compiled/react-server-dom-webpack/client.node",
        );
        const encoded = await encodeReply([body]);
        assert.ok(encoded instanceof FormData);
        return encoded;
      }
      const home = await (await fetch(base)).text();
      assert.match(home, /Your next session starts here/);
      assert.match(home, /Unconfigured/);
      assert.match(home, /Extraction settings/);
      const settingsPage = await (
        await fetch(`${base}/settings/chatgpt`)
      ).text();
      assert.match(settingsPage, /Continue with ChatGPT/);
      assert.match(settingsPage, /Photos are sent to OpenAI/);
      const connectEntry = Object.entries(manifest.node).find(
        ([, value]) =>
          (value as { exportedName: string }).exportedName === "connectChatGPT",
      );
      assert.ok(connectEntry);
      const { encodeReply: encodeSignIn } = createRequire(import.meta.url)(
        "next/dist/compiled/react-server-dom-webpack/client.node",
      );
      const signIn = await fetch(`${base}/settings/chatgpt`, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Next-Action": connectEntry[0],
          Origin: base,
          Accept: "text/x-component",
        },
        body: await encodeSignIn([new FormData()]),
      });
      const authorization = new URL(
        signIn.headers.get("x-action-redirect")!.split(";")[0],
      );
      assert.equal(authorization.origin, "https://auth.openai.com");
      assert.equal(
        authorization.searchParams.get("redirect_uri"),
        `${base}/auth/callback`,
      );
      assert.match(signIn.headers.get("set-cookie")!, /HttpOnly/);
      assert.match(signIn.headers.get("set-cookie")!, /SameSite=lax/);
      const deniedCallback = new URL(`${base}/auth/callback`);
      deniedCallback.search = new URLSearchParams({
        state: authorization.searchParams.get("state")!,
        error: "access_denied",
      }).toString();
      const denied = await fetch(deniedCallback, {
        redirect: "manual",
        headers: {
          Cookie: signIn.headers.get("set-cookie")!.split(";")[0],
        },
      });
      assert.match(
        decodeURIComponent(denied.headers.get("Location")!),
        /sign-in was declined/,
      );
      const invalidCallback = await fetch(
        `${base}/auth/callback?code=synthetic&state=wrong`,
        { redirect: "manual" },
      );
      assert.equal(invalidCallback.status, 303);
      assert.match(invalidCallback.headers.get("Location")!, /error=/);
      assert.equal(invalidCallback.headers.get("Cache-Control"), "no-store");
      const uploaded = await action<
        Result<{ session: RecordSession; duplicate: boolean }>
      >("uploadPhotos", await uploadBody());
      assert.equal(uploaded.ok, true, JSON.stringify(uploaded));
      if (!uploaded.ok) return;
      const session = uploaded.value.session;
      assert.equal(session.photos.length, 1);
      assert.equal(session.confirmedAt, null);
      const path = `/sessions/${session.id}`;
      const editor = await (await fetch(`${base}${path}`)).text();
      assert.match(editor, /Teaching record/);
      assert.match(editor, /Delete draft/);
      assert.doesNotMatch(editor, /Instructor \/ supervisor|Flight remarks/);
      assert.match(editor, /explicit-synthetic-test.png/);
      assert.doesNotMatch(logs, /Only plain objects/);
      const photo = await fetch(`${base}/photos/${session.photos[0].id}`);
      assert.equal(photo.headers.get("Content-Type"), "image/png");
      assert.equal(photo.headers.get("Cache-Control"), "private, no-store");
      assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);
      const student = await action<Result<Student>>(
        "createStudent",
        ["Synthetic HTTP Student"],
        path,
      );
      assert.equal(student.ok, true);
      if (!student.ok) return;
      const invalid = await action<Result<RecordSession>>(
        "saveSession",
        [session.id, 1, session.draft, true, false],
        path,
      );
      assert.equal(invalid.ok, false);
      if (!invalid.ok) assert.match(invalid.error, /preparation/);
      const draft = draftFromSheet(sheetReading(), "Synthetic reviewed source");
      draft.studentId = student.value.id;
      draft.identityConfirmed = true;
      draft.reviewComplete = true;
      draft.blocks.forEach((b) =>
        b.flights.forEach((f) => {
          f.activity = "dual";
        }),
      );
      const saved = await action<Result<RecordSession>>(
        "saveSession",
        [session.id, 1, draft, false, false],
        path,
      );
      assert.equal(saved.ok, true);
      if (!saved.ok) return;
      assert.equal(saved.value.revision, 2);
      assert.equal(saved.value.confirmedAt, null);
      const retry = await action<Result<RecordSession>>(
        "saveSession",
        [session.id, 1, draft, false, false],
        path,
      );
      assert.equal(retry.ok, true);
      if (!retry.ok) return;
      assert.equal(retry.value.revision, 2);
      const confirmed = await action<Result<RecordSession>>(
        "saveSession",
        [session.id, 2, draft, true, true],
        path,
      );
      assert.equal(confirmed.ok, true);
      if (!confirmed.ok) return;
      assert.ok(confirmed.value.confirmedAt);
      const protectedDeletion = await action<Result<{ deleted: boolean }>>(
        "deleteDraft",
        [session.id, 2],
        path,
      );
      assert.equal(protectedDeletion.ok, false);
      if (!protectedDeletion.ok)
        assert.match(protectedDeletion.error, /confirmation history/);
      await stop();
      server = start();
      await waitForReady();
      const reopened = await (await fetch(`${base}${path}`)).text();
      assert.match(reopened, /Confirmed/);
      assert.doesNotMatch(reopened, /Delete draft/);
      assert.match(reopened, /Example, Alex/);
      assert.match(reopened, /Source transcription/);
      assert.match(reopened, /Synthetic reviewed source/);
      assert.match(reopened, /Synthetic HTTP Student/);
      const duplicate = await action<
        Result<{ session: RecordSession; duplicate: boolean }>
      >("uploadPhotos", await uploadBody());
      assert.equal(duplicate.ok, true);
      if (!duplicate.ok) return;
      assert.equal(duplicate.value.duplicate, true);
      assert.equal(duplicate.value.session.id, session.id);
      const extracted = await action<Result<{ session: RecordSession }>>(
        "extractSession",
        [session.id, 2],
        path,
      );
      assert.equal(extracted.ok, true);
      if (!extracted.ok) return;
      assert.match(extracted.value.session.extractionNote, /unconfigured/);
      assert.deepEqual(extracted.value.session.draft, draft);
      // Exercise the built action's subscription branch without credentials:
      // a failed ChatGPT read must preserve the reviewed record and originals.
      const connection = new ChatGPT(join(temp, "local/chatgpt"));
      await connection.configure("chatgpt");
      const noAccount = await action<Result<{ session: RecordSession }>>(
        "extractSession",
        [session.id, 2],
        path,
      );
      assert.equal(noAccount.ok, true);
      if (!noAccount.ok) return;
      assert.match(
        noAccount.value.session.extractionNote,
        /ChatGPT extraction failed/,
      );
      assert.deepEqual(noAccount.value.session.draft, draft);
      const staleExtraction = await action<Result<{ session: RecordSession }>>(
        "extractSession",
        [session.id, 1],
        path,
      );
      assert.equal(staleExtraction.ok, false);
      await withChatGPTState(connection.directory, async (state) => {
        state.activeId = "synthetic-account";
        state.accounts = [
          {
            id: "synthetic-account",
            clientId: "synthetic-client",
            model: "synthetic-vision",
            credentials: {
              accessToken: "never-send-this-test-token",
              idToken: "synthetic",
              scopes: ["chatgpt.tokens.use.direct"],
              expiresAt: Date.now() + 3600000,
            },
          },
        ];
      });
      const changedProvider = await action<Result<{ session: RecordSession }>>(
        "extractSession",
        [session.id, 2, null],
        path,
      );
      assert.equal(changedProvider.ok, false);
      if (!changedProvider.ok)
        assert.match(changedProvider.error, /settings changed/);
      const selectedEditor = await (await fetch(`${base}${path}`)).text();
      assert.match(selectedEditor, /Read with ChatGPT/);
      assert.match(selectedEditor, /Sends all linked photos to OpenAI/);
      assert.doesNotMatch(selectedEditor, /never-send-this-test-token/);
      await connection.configure("ollama");
      const changed = await action<Result<RecordSession>>(
        "saveSession",
        [session.id, 2, { ...draft, remarks: "Edited via HTTP" }, false, false],
        path,
      );
      assert.equal(changed.ok, true);
      if (!changed.ok) return;
      assert.equal(changed.value.confirmedAt, null);
      assert.equal((await fetch(`${base}/photos/not-a-hash`)).status, 404);
      const newBody = new FormData();
      newBody.set(
        "photos",
        new File(
          [Buffer.concat([png, Buffer.from("deletion test")])],
          "deletable-synthetic.png",
          { type: "image/png" },
        ),
      );
      const { encodeReply } = createRequire(import.meta.url)(
        "next/dist/compiled/react-server-dom-webpack/client.node",
      );
      const newUpload = await action<Result<{ session: RecordSession }>>(
        "uploadPhotos",
        await encodeReply([newBody]),
      );
      assert.equal(newUpload.ok, true);
      if (!newUpload.ok) return;
      const removable = newUpload.value.session;
      const deletePath = `/sessions/${removable.id}`;
      const deleted = await action<Result<{ deleted: boolean }>>(
        "deleteDraft",
        [removable.id, removable.revision],
        deletePath,
      );
      assert.equal(deleted.ok, true);
      assert.equal((await fetch(`${base}${deletePath}`)).status, 404);
      assert.equal(
        (await fetch(`${base}/photos/${removable.photos[0].id}`)).status,
        404,
      );
      const repeatDeletion = await action<Result<{ deleted: boolean }>>(
        "deleteDraft",
        [removable.id, removable.revision],
      );
      assert.equal(repeatDeletion.ok, true);
      assert.equal((await fetch(`${base}${path}`)).status, 200);
    } finally {
      await stop();
      rmSync(temp, { recursive: true, force: true });
    }
  },
);
