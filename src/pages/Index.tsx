import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { useAuth } from '@/contexts/AuthContext';
import { MapPin, Users, FolderOpen, Camera, ArrowRight } from 'lucide-react';

export default function Index() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard');
    }
  }, [user, loading, navigate]);

  const features = [
    {
      icon: FolderOpen,
      title: 'Organize with Folders',
      description: 'Create custom folders like Cafes, Brunch, Fine Dining, or Budget-Friendly to keep your lists organized.',
    },
    {
      icon: MapPin,
      title: 'Interactive Map',
      description: 'See all your saved restaurants on an interactive map to plan your next food adventure.',
    },
    {
      icon: Users,
      title: 'Follow Friends',
      description: 'Connect with friends and discover their favorite spots. Share and explore together.',
    },
    {
      icon: Camera,
      title: 'Add Photos',
      description: 'Capture your dining experiences with photos and notes to remember every meal.',
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/20 to-background" />
        <div className="container relative py-24 md:py-32">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-primary to-accent-foreground bg-clip-text text-transparent">
              Track Your Culinary Journey
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              Save restaurants you want to try, mark places you've visited, discover new spots through friends, and share your favorite recipes with the community.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" onClick={() => navigate('/auth?mode=signup')} className="text-lg px-8">
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate('/auth')}>
                Sign In
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-card">
        <div className="container">
          <h2 className="text-3xl font-bold text-center mb-12">
            Everything you need to track your food adventures
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {features.map((feature) => (
              <div key={feature.title} className="text-center p-6 rounded-xl bg-background shadow-sm">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <feature.icon className="h-7 w-7 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                <p className="text-muted-foreground text-sm">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="container">
          <div className="bg-gradient-to-r from-primary to-accent-foreground rounded-2xl p-12 text-center">
            <h2 className="text-3xl font-bold text-primary-foreground mb-4">
              Start Your Food Journey Today
            </h2>
            <p className="text-primary-foreground/80 mb-8 max-w-xl mx-auto">
              Join food lovers who are tracking their restaurant adventures and discovering new places together.
            </p>
            <Button size="lg" variant="secondary" onClick={() => navigate('/auth?mode=signup')}>
              Create Free Account
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-border">
        <div className="container text-center text-muted-foreground">
          <p>© 2025 Afiyeat. All rights reserved.</p>
          <div className="flex justify-center gap-4 mt-2 text-sm">
            <a href="/terms" className="hover:text-foreground transition-colors">Terms of Service</a>
            <span>·</span>
            <a href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
