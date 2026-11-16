import { cookies } from "next/headers";
import { chatGPT } from "../../../../lib/chatgpt.ts";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const jar = await cookies();
  let destination = "/settings/chatgpt";
  try {
    // Next.js can normalize request.url's hostname to localhost internally.
    // OAuth must instead validate the address the browser actually requested.
    // Accept only our IPv4 loopback host; never trust forwarded host headers.
    const host = request.headers.get("host");
    const origin = new URL(`http://${host}`);
    if (origin.hostname !== "127.0.0.1" || origin.origin !== `http://${host}`)
      throw new Error("Open the app at 127.0.0.1 to complete ChatGPT sign-in.");
    const callback = new URL(request.url);
    callback.host = origin.host;
    callback.protocol = origin.protocol;
    await chatGPT.finishSignIn(callback, jar.get("fit-chatgpt-state")?.value);
  } catch (error) {
    destination += `?error=${encodeURIComponent(error instanceof Error ? error.message : "ChatGPT sign-in failed.")}`;
  }
  jar.delete({ name: "fit-chatgpt-state", path: "/auth/callback" });
  // A clean redirect removes the one-time code from the visible page URL.
  return new Response(null, {
    status: 303,
    headers: {
      Location: destination,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
