import { LegalDocument } from "@/components/legal/legal-document";
import { legalCenter } from "@/config/legal";
import { publicPageMetadata } from "@/lib/seo";

const document = legalCenter.documents.platformTerms;

export const metadata = publicPageMetadata({
  description: document.description,
  path: document.path,
  title: document.title,
});

export default function TermsPage() {
  return <LegalDocument document={document} />;
}
