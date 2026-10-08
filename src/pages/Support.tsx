import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Navbar } from '@/components/layout/Navbar';
import { Seo } from '@/components/Seo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SUPPORT_EMAIL } from '@/components/legal/LegalPage';
import { buildLabel } from '@/lib/buildInfo';
import { isNative } from '@/lib/native';

/**
 * /support - how to reach us and how to handle the common things people
 * ask about. Public (no sign-in needed) and used as the App Store
 * "Support URL".
 */
export default function Support() {
  const [copied, setCopied] = useState(false);

  // Only non-identifying details: which build and platform. No account or
  // content data goes into the draft.
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Afiyeat support')}&body=${encodeURIComponent(
    `\n\n---\nApp: ${isNative() ? 'iPhone app' : 'website'} · build ${buildLabel()}`,
  )}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Press and hold the address to copy it.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Seo title="Help & Support | Afiyeat" description="Contact Afiyeat support and get help with your account." path="/support" />
      <Navbar />
      <main className="container py-8 sm:py-12 px-4 sm:px-6 max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Help &amp; Support</h1>
          <p className="text-muted-foreground mt-1">
            Questions, problems, or something to report? We read every message.
          </p>
        </div>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Email us at</p>
              <p className="text-lg font-semibold select-all break-all">{SUPPORT_EMAIL}</p>
              <p className="text-xs text-muted-foreground mt-1">We usually reply within a day or two.</p>
            </div>
            <div className="flex gap-2">
              <Button asChild className="flex-1">
                <a href={mailto}>
                  <Mail className="h-4 w-4 mr-2" />
                  Email support
                </a>
              </Button>
              <Button variant="outline" className="flex-1" onClick={copy}>
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? 'Copied' : 'Copy address'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <section className="space-y-4 text-sm text-muted-foreground leading-relaxed">
          <div>
            <h2 className="text-base font-semibold text-foreground mb-1">Report a post or an account</h2>
            <p>
              Open the profile, list or recipe, tap the "…" menu and choose <strong>Report</strong>. Reports
              are reviewed, usually within 24 hours. For anything urgent, email us as well.
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground mb-1">Block someone</h2>
            <p>
              From their profile, tap "…" and choose <strong>Block</strong>. You won't see each other's content
              and any follows between you are removed. Manage blocked accounts in Profile.
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground mb-1">Make your profile private</h2>
            <p>In Profile, switch your account to private. Only followers you approve will see your places and lists.</p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground mb-1">Delete your account</h2>
            <p>
              In Profile, scroll down and tap <strong>Delete account</strong>. This permanently removes your account
              and its data. See the{' '}
              <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link> for details.
            </p>
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground mb-1">Forgot your password</h2>
            <p>On the sign-in screen, tap <strong>Forgot password</strong> and we'll email you a code.</p>
          </div>
        </section>

        <div className="pt-4 border-t border-border flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
          <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link>
          <span className="text-muted-foreground/70">Build {buildLabel()}</span>
        </div>
      </main>
    </div>
  );
}
