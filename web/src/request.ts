/** Resolves to a successful response, or throws the server's error message or the fallback. */
export async function request(url: string, init: RequestInit, fallback: string) {
  const response = await fetch(url, init);
  if (response.ok) return response;
  // The host check and the router can answer with plain text.
  const body = await response.json().catch(() => null);
  throw new Error(body?.error || fallback);
}
