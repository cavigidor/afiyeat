import { Navbar } from "@/components/layout/Navbar";
import { Link } from "react-router-dom";

const Privacy = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container py-12 max-w-4xl">
        <h1 className="text-3xl font-bold mb-8">Privacy Policy</h1>
        
        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-6">
          <p className="text-muted-foreground">
            <strong>Last updated:</strong> December 2024
          </p>

          <section>
            <h2 className="text-xl font-semibold mt-8 mb-4">1. Information We Collect</h2>
            <p className="text-muted-foreground">
              We collect information you provide directly, including: email address, profile information, 
              restaurant lists, reviews, and any content you choose to share.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-8 mb-4">2. How We Use Your Information</h2>
            <p className="text-muted-foreground">
              We use your information to: provide and improve our services, personalize your experience, 
              communicate with you, and ensure the security of our platform.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-8 mb-4">3. Information Sharing</h2>
            <p className="text-muted-foreground">
              Your restaurant lists and profile are visible to users you approve as followers 
              (for private profiles) or publicly (for public profiles). We do not sell your personal 
              information to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-8 mb-4">4. Data Storage</h2>
            <p className="text-muted-foreground">
              Your data is stored securely using industry-standard encryption and security practices. 
              We retain your data for as long as your account is active.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-8 mb-4">5. Your Rights</h2>
            <p className="text-muted-foreground">
              You have the right to access, correct, or delete your personal information. 
              You can manage your data through your account settings or by contacting us.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-8 mb-4">6. Cookies</h2>
            <p className="text-muted-foreground">
              We use cookies and similar technologies to maintain your session and improve your experience. 
              You can control cookie preferences through your browser settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mt-8 mb-4">7. Contact</h2>
            <p className="text-muted-foreground">
              For privacy-related questions, please contact us at [YOUR EMAIL ADDRESS].
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

export default Privacy;
