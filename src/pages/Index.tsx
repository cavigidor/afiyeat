import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { useAuth } from '@/contexts/AuthContext';
import { MapPin, Users, ChefHat, Camera, ArrowRight } from 'lucide-react';
import { Seo } from '@/components/Seo';

export default function Index() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate('/news');
    }
  }, [user, loading, navigate]);

  const features = [
    {
      icon: ChefHat,
      title: 'Recipe Sharing App',
      description: 'Add your favorite recipes and discover dishes shared by friends. Build your personal recipe collection and share with the community.',
    },
    {
      icon: MapPin,
      title: 'Restaurant Tracker Map',
      description: 'Track restaurants on an interactive map. Save places you want to visit and mark spots you\'ve been to plan your next food adventure.',
    },
    {
      icon: Users,
      title: 'Social Food Discovery',
      description: 'Follow friends and discover their favorite restaurants and recipes. Share your food journal and explore together.',
    },
    {
      icon: Camera,
      title: 'Food Journal & Photos',
      description: 'Keep a food diary with photos and notes. Capture your dining experiences to remember every meal and track your culinary journey.',
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-accent/20 to-background" />
        <div className="container relative py-12 sm:py-24 md:py-32 px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-3xl sm:text-4xl md:text-6xl font-bold mb-4 sm:mb-6 bg-gradient-to-r from-primary to-accent-foreground bg-clip-text text-transparent leading-tight pb-2">
              Your Free Restaurant Tracker & Recipe Sharing App
            </h1>
            <p className="text-base sm:text-xl text-muted-foreground mb-6 sm:mb-8 max-w-2xl mx-auto">
              Track restaurants you want to visit, save places you've been, share recipes with friends, and keep a food journal of your culinary adventures — all in one free app.
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

      {/* What is Afiyeat Section */}
      <section className="py-12 sm:py-16 bg-background">
        <div className="container px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">What is Afiyeat?</h2>
          <p className="text-muted-foreground text-base sm:text-lg">
            Afiyeat is a free restaurant tracker and recipe sharing app that helps food lovers save restaurants, keep a food journal, and share recipes with friends. Whether you're building a dining wishlist or logging places you've visited, Afiyeat makes it easy to track your culinary journey.
          </p>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-12 sm:py-20 bg-card">
        <div className="container px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-8 sm:mb-12">
            Everything you need to track restaurants and share recipes
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-8">
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
      <section className="py-12 sm:py-20">
        <div className="container px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-r from-primary to-accent-foreground rounded-2xl p-6 sm:p-12 text-center">
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
