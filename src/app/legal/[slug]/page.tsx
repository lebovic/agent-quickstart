import { readFileSync } from "fs"
import { notFound } from "next/navigation"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"

const LEGAL_DOCS: Record<string, { file: string; title: string }> = {
  terms: { file: "legal/terms-of-service.md", title: "Terms of Service" },
  privacy: { file: "legal/privacy-policy.md", title: "Privacy Policy" },
}

export function generateStaticParams() {
  return Object.keys(LEGAL_DOCS).map((slug) => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const doc = LEGAL_DOCS[slug]
  return { title: doc ? doc.title : "Not Found" }
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const doc = LEGAL_DOCS[slug]

  if (!doc) {
    notFound()
  }

  let content: string
  try {
    content = readFileSync(doc.file, "utf-8")
  } catch {
    content = `# ${doc.title}\n\nDocument not found.`
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <article className="legal-content">
          <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
        </article>
      </div>
    </div>
  )
}
