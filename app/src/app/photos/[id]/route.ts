import { getStore } from "../../../../lib/store.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const photo = getStore().photo((await params).id);
    return new Response(new Uint8Array(photo.bytes), {
      headers: {
        "Content-Type": photo.mime,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response("Photo not found", { status: 404 });
  }
}
