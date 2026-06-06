import { Navbar } from "@/components/layout/Navbar";
import { Link } from "react-router-dom";
import { Seo } from "@/components/Seo";

const Terms = () => {
  return (
    <div className="min-h-screen bg-background">
      <Seo
        title="Terms of Service | Afiyeat"
        description="Read the Terms of Service for Afiyeat, the free restaurant tracker and recipe sharing app."
        path="/terms"
      />
      <Navbar />
      <main className="container py-12 max-w-4xl">
        <h1 className="text-3xl font-bold mb-8">Terms of Service</h1>
        
        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-6">
          <p className="text-muted-foreground">
            <strong>Last updated:</strong> December 2024
          </p>

          <section>
            <h2 className="text-xl font-semibold mt-8 mb-4">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground">
              By accessing and using Afiyeat, you agree to be bound by these Terms of Service. 
              If you do not agree to these terms, please do not use our service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-8 mb-4">2. Description of Service</h2>
            <p className="text-muted-foreground">
              Afiyeat is a social restaurant tracking platform that allows users to save, 
              organize, and share their dining experiences with friends.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-8 mb-4">3. User Accounts</h2>
            <p className="text-muted-foreground">
              You are responsible for maintaining the confidentiality of your account credentials 
              and for all activities that occur under your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-8 mb-4">4. User Content</h2>
            <p className="text-muted-foreground">
              You retain ownership of content you submit. By posting content, you grant Afiyeat 
              a non-exclusive license to use, display, and distribute your content within the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-8 mb-4">5. Prohibited Conduct</h2>
            <p className="text-muted-foreground">
              You agree not to misuse the service, including but not limited to: posting harmful content, 
              attempting to access other users' accounts, or using the service for illegal purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-8 mb-4">6. Disclaimer</h2>
            <p className="text-muted-foreground">
              The service is provided "as is" without warranties of any kind. Restaurant information 
              is user-generated and may not be accurate or up-to-date.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-8 mb-4">7. Contact</h2>
            <p className="text-muted-foreground">
              For questions about these Terms, please contact us at{" "}
              <a href="mailto:avigidor@gmail.com" className="text-primary hover:underline">avigidor@gmail.com</a>.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-border">
          <Link to="/" className="text-primary hover:underline">
            ← Back to Home
          </Link>
        </div>
      </main>
    </div>
  );
};

export default Terms;
