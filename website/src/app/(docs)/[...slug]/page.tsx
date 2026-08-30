import type { Metadata } from "next";
import { DocView, docMetadata } from "@/components/DocView";
import { source } from "@/lib/source";

interface PageProps {
  params: Promise<{ slug: string[] }>;
}

export default async function Page(props: PageProps) {
  const { slug } = await props.params;
  return <DocView slug={slug} />;
}

// The site root is rendered by `(docs)/page.tsx`, not by this catch-all.
export async function generateStaticParams() {
  return source.generateParams().filter((param) => param.slug.length > 0);
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const { slug } = await props.params;
  return docMetadata(slug);
}
