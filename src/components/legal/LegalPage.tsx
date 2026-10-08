import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Seo } from '@/components/Seo';

export const SUPPORT_EMAIL = 'support@afiyeat.com';

export interface LegalSection {
  title: string;
  body: ReactNode;
}

interface LegalPageProps {
  title: string;
  seoTitle: string;
  seoDescription: string;
  path: string;
  updated: string;
  intro?: ReactNode;
  sections: LegalSection[];
}

/** Shared layout for the Privacy Policy, Terms and Support pages. */
export function LegalPage({ title, seoTitle, seoDescription, path, updated, intro, sections }: LegalPageProps) {
  return (
    <div className="min-h-screen bg-background">
      <Seo title={seoTitle} description={seoDescription} path={path} />
      <Navbar />
      <main className="container py-8 sm:py-12 px-4 sm:px-6 max-w-3xl">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground mb-6">Last updated: {updated}</p>
        {intro && <div className="text-muted-foreground space-y-3 mb-6">{intro}</div>}
        <div className="space-y-8">
          {sections.map((section, i) => (
            <section key={section.title}>
              <h2 className="text-lg sm:text-xl font-semibold mb-3">
                {i + 1}. {section.title}
              </h2>
              <div className="text-muted-foreground space-y-3 leading-relaxed">{section.body}</div>
            </section>
          ))}
        </div>
        <div className="mt-12 pt-6 border-t border-border flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
          <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link>
          <Link to="/support" className="text-primary hover:underline">Help &amp; Support</Link>
        </div>
      </main>
    </div>
  );
}

export function SupportEmailLink() {
  return (
    <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">
      {SUPPORT_EMAIL}
    </a>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1.5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
