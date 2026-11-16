import { notFound } from "next/navigation";
import { getStore } from "../../../../lib/store.ts";
import { extractionProvider } from "../../../../lib/extraction-provider.ts";
import type { ExtractionProvider } from "../../../../lib/extraction-provider.ts";
import Editor from "../../../components/Editor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ upload?: string }>;
}) {
  const { id } = await params;
  const store = getStore();
  const session = (() => {
    try {
      return store.get(id);
    } catch {
      notFound();
    }
  })();
  let extractor: ExtractionProvider | null = null;
  try {
    extractor = await extractionProvider();
  } catch {
    /* The editor supports manual entry. */
  }
  return (
    <Editor
      key={`${id}-${session.revision}`}
      initial={session}
      students={store.students()}
      extractor={extractor}
      suggestedStudentId={store.suggestStudent(
        session.draft.handwrittenStudent,
      )}
      upload={(await searchParams).upload}
    />
  );
}
