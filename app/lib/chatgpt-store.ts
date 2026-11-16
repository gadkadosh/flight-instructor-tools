import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";

export type Credentials = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  earliestRefreshAt?: number;
  idToken: string;
  scopes: string[];
};
export type Account = {
  id: string;
  clientId: string;
  subject?: string;
  email?: string;
  model?: string;
  credentials?: Credentials;
  rotation?: { credentials: Credentials; receivedAt: number };
};
export type PendingSignIn = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
  accountId?: string;
};
export type ChatGPTState = {
  version: 1;
  hostId: string;
  provider: "ollama" | "chatgpt";
  accounts: Account[];
  activeId?: string;
  pending?: PendingSignIn;
  welcomed?: boolean;
};

// Lock across Next.js workers and scripts: rotating refresh tokens must have
// exactly one writer. Reads and writes use the same protected local directory.
export async function withChatGPTState<T>(
  directory: string,
  operation: (
    state: ChatGPTState,
    checkpoint: () => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const unlock = await lockfile.lock(directory, {
    stale: 120_000,
    update: 10_000,
    retries: { retries: 30, minTimeout: 100, maxTimeout: 500 },
  });
  try {
    const path = join(directory, "connection.json");
    let state: ChatGPTState;
    let exists = true;
    try {
      state = JSON.parse(await readFile(path, "utf8"));
      if (
        state.version !== 1 ||
        !state.hostId ||
        !Array.isArray(state.accounts)
      )
        throw new Error(
          "Unsupported ChatGPT connection file. Existing credentials were preserved.",
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      exists = false;
      state = {
        version: 1,
        hostId: `urn:uuid:${randomUUID()}`,
        provider: "ollama",
        accounts: [],
      };
    }
    let saved = JSON.stringify(state);
    const checkpoint = async () => {
      const contents = JSON.stringify(state);
      // Persist the installation ID even when the first operation is a read.
      if (exists && contents === saved) return;
      const temporary = join(directory, `${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
        saved = contents;
        exists = true;
      } finally {
        await rm(temporary, { force: true });
      }
    };
    // Also persist consumed codes and received refresh rotations on failure.
    try {
      return await operation(state, checkpoint);
    } finally {
      await checkpoint();
    }
  } finally {
    await unlock();
  }
}
