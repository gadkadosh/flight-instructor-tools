"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { chatGPT } from "../../../../lib/chatgpt.ts";

export async function connectChatGPT(form: FormData) {
  const host = (await headers()).get("host");
  const id = form.get("accountId");
  let authorization;
  try {
    authorization = await chatGPT.startSignIn(
      `http://${host}`,
      typeof id === "string" && id ? id : undefined,
    );
  } catch (error) {
    redirect(
      `/settings/chatgpt?error=${encodeURIComponent(error instanceof Error ? error.message : "Sign-in failed.")}`,
    );
  }
  (await cookies()).set("fit-chatgpt-state", authorization.state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/auth/callback",
    maxAge: 600,
  });
  redirect(authorization.url);
}

export async function configureExtraction(form: FormData) {
  try {
    const provider = form.get("provider") === "ollama" ? "ollama" : "chatgpt";
    const id = form.get("accountId");
    const model = form.get("model");
    await chatGPT.configure(
      provider,
      typeof id === "string" && id ? id : undefined,
      typeof model === "string" && model ? model : undefined,
    );
    revalidatePath("/", "layout");
  } catch (error) {
    redirect(
      `/settings/chatgpt?error=${encodeURIComponent(error instanceof Error ? error.message : "Settings could not be saved.")}`,
    );
  }
  redirect("/settings/chatgpt");
}

export async function disconnectChatGPT() {
  try {
    await chatGPT.disconnect();
  } catch (error) {
    redirect(
      `/settings/chatgpt?error=${encodeURIComponent(error instanceof Error ? error.message : "Disconnection failed.")}`,
    );
  }
  revalidatePath("/", "layout");
  redirect("/settings/chatgpt");
}

export async function acknowledgeChatGPT() {
  await chatGPT.welcome();
  redirect("/settings/chatgpt");
}
