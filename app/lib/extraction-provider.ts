import { chatGPT } from "./chatgpt.ts";
import { ollamaConfig } from "./extraction.ts";

export type ExtractionProvider =
  | { provider: "ollama"; model: string }
  | {
      provider: "chatgpt";
      model: string;
      accountId: string;
      accountLabel: string;
    };

export async function extractionProvider(): Promise<ExtractionProvider | null> {
  const settings = await chatGPT.settings();
  if (settings.provider === "chatgpt") {
    const account = settings.accounts.find((a) => a.id === settings.activeId);
    return account?.sharing && account.model
      ? {
          provider: "chatgpt",
          model: account.model,
          accountId: account.id,
          accountLabel: account.email ?? "ChatGPT account",
        }
      : null;
  }
  const config = ollamaConfig();
  return config ? { provider: "ollama", model: config.model } : null;
}
