"use server";

import { revalidatePath } from "next/cache";
import { getStore } from "../../lib/store.ts";
import { extractPhotos, ollamaConfig } from "../../lib/extraction.ts";
import { extractWithChatGPT } from "../../lib/chatgpt-extraction.ts";
import { chatGPT } from "../../lib/chatgpt.ts";
import { extractionProvider } from "../../lib/extraction-provider.ts";
import type { ExtractionProvider } from "../../lib/extraction-provider.ts";
import type { Draft } from "../../lib/record.ts";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
async function attempt<T>(operation: () => T | Promise<T>): Promise<Result<T>> {
  try {
    const value = await operation();
    revalidatePath("/");
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The operation failed.",
    };
  }
}

export async function uploadPhotos(form: FormData) {
  return attempt(async () => {
    const files = form.getAll("photos");
    if (files.some((f) => !(f instanceof File)))
      throw new Error("Choose photo files.");
    const photos = files as File[];
    if (
      photos.length > 8 ||
      photos.reduce((sum, f) => sum + f.size, 0) > 20 * 1024 * 1024
    )
      throw new Error("Choose up to 8 photos, totalling at most 20 MiB.");
    const target = form.get("sessionId");
    const revision = form.get("revision");
    return getStore().upload(
      await Promise.all(
        photos.map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      ),
      typeof target === "string" && target ? target : undefined,
      revision ? Number(revision) : undefined,
    );
  });
}

export async function saveSession(
  id: string,
  revision: number,
  draft: Draft,
  confirm = false,
  rememberAlias = false,
) {
  return attempt(() =>
    getStore().save(id, revision, draft, confirm, rememberAlias),
  );
}

export async function createStudent(name: string) {
  return attempt(() => getStore().addStudent(name));
}

export async function deleteDraft(id: string, revision: number) {
  return attempt(() => {
    getStore().deleteDraft(id, revision);
    return { deleted: true };
  });
}

export async function extractSession(
  id: string,
  revision: number,
  expected: ExtractionProvider | null = null,
) {
  return attempt(async () => {
    const store = getStore();
    const current = store.get(id);
    if (current.revision !== revision)
      throw new Error("The session changed. Reload before extracting.");
    const config = await extractionProvider();
    if (JSON.stringify(config) !== JSON.stringify(expected))
      throw new Error(
        "Extraction settings changed. Reload before reading these photos.",
      );
    const photos = current.photos.map((p) => store.photo(p.id));
    const settings = await chatGPT.settings();
    const result = !config
      ? {
          draft: null,
          sourceReading: "",
          note:
            settings.provider === "chatgpt"
              ? "ChatGPT extraction failed: Connect your account and choose a model in extraction settings. Your saved draft and photos are retained."
              : "Extraction is unconfigured. Configure a model or enter this draft manually.",
        }
      : config.provider === "chatgpt"
        ? await extractWithChatGPT(photos, async () => {
            const access = await chatGPT.access();
            if (
              access.accountId !== config.accountId ||
              access.model !== config.model
            )
              throw new Error(
                "The ChatGPT account or model changed. Reload before extracting.",
              );
            return access;
          })
        : await extractPhotos(photos, ollamaConfig());
    // A long extraction cannot overwrite edits saved in another tab.
    if (store.get(id).revision !== revision)
      throw new Error(
        "The draft changed during extraction. Saved edits were kept; reload to continue.",
      );
    const session = store.save(
      id,
      revision,
      result.draft ?? current.draft,
      false,
      false,
      result.note,
    );
    return {
      session,
      suggestedStudentId: store.suggestStudent(
        session.draft.handwrittenStudent,
      ),
    };
  });
}
