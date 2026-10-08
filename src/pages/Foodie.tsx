import { useState } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Newspaper, ChefHat } from 'lucide-react';
import News from './News';
import Recipes from './Recipes';

// News & Recs is switched off for the first release: it only covered three
// cities, cost money to refresh and republished summaries of other sites'
// articles. The code stays so it can come back (or be replaced by a feed
// built from Afiyeat's own activity); flip this to bring the tab back.
// The generate-news function is separately gated by its NEWS_ENABLED secret.
const NEWS_ENABLED = false;

type FoodieTab = 'news' | 'recipes';

// The "browse/discover" food screen, distinct from My Lists (which is for
// things you're personally tracking: restaurants and custom lists). With
// News off, this is Recipes on its own - no single-option tab bar.
export default function Foodie() {
  const [tab, setTab] = useState<FoodieTab>(NEWS_ENABLED ? 'news' : 'recipes');

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {NEWS_ENABLED && (
        <div className="container px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6">
          <Tabs value={tab} onValueChange={(v) => setTab(v as FoodieTab)}>
            <TabsList>
              <TabsTrigger value="news" className="gap-1.5">
                <Newspaper className="h-4 w-4" />
                News &amp; Recs
              </TabsTrigger>
              <TabsTrigger value="recipes" className="gap-1.5">
                <ChefHat className="h-4 w-4" />
                Recipes
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {NEWS_ENABLED && tab === 'news' ? <News /> : <Recipes />}
    </div>
  );
}
