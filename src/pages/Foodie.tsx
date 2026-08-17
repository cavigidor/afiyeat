import { useState } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Newspaper, ChefHat } from 'lucide-react';
import News from './News';
import Recipes from './Recipes';

type FoodieTab = 'news' | 'recipes';

// Combines the two "browse/discover" food screens - News & Recs and
// Recipes - under one tab, distinct from My Lists (which is for things
// you're personally tracking: restaurants and custom lists). News.tsx and
// Recipes.tsx are rendered here as plain content (their own <Navbar/> and
// full-page wrapper were removed - this page owns both now).
export default function Foodie() {
  const [tab, setTab] = useState<FoodieTab>('news');

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

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

      {tab === 'news' ? <News /> : <Recipes />}
    </div>
  );
}
