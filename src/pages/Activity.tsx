import { Navbar } from '@/components/layout/Navbar';

// Placeholder for the Activity screen (filled in at CP4).
export default function Activity() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container py-4 sm:py-8 px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl sm:text-3xl font-bold">Activity</h1>
      </main>
    </div>
  );
}
