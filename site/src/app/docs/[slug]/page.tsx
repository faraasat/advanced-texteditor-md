import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsShell } from "@/components/docs-shell";
import { SITE } from "@/lib/config";
import { DOC_PAGES, renderDoc } from "@/lib/docs";

export const dynamicParams = false;
export const generateStaticParams = () => DOC_PAGES.map((p) => ({ slug: p.slug }));

export async function generateMetadata({ params }: PageProps<"/docs/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = DOC_PAGES.find((p) => p.slug === slug);
  if (!page) return {};
  return { title: page.nav, description: page.description, alternates: { canonical: `${SITE.url}docs/${page.slug}/` } };
}

export default async function DocPage({ params }: PageProps<"/docs/[slug]">) {
  const { slug } = await params;
  const page = DOC_PAGES.find((p) => p.slug === slug);
  if (!page) notFound();
  const { html, toc } = renderDoc(page);
  return (
    <DocsShell current={page.slug} toc={toc} source={page.source}>
      {/* Trusted: renderHtml escapes every text and attribute value, and refuses raw HTML and unsafe URLs. */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </DocsShell>
  );
}
