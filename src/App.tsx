import { useEffect } from "react";
import {
  configureStatusBar,
  hideSplashScreen,
  requestStartupPermissions,
} from "@/lib/native";
import { useAuth } from "@/contexts/AuthContext";
import { claimPendingReferral, readPendingReferral } from "@/lib/passport";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { PushNotificationManager } from "@/components/shared/PushNotificationManager";
import { BottomTabBar } from "@/components/layout/BottomTabBar";
import { PersistentTabs } from "@/components/layout/PersistentTabs";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Search from "./pages/Search";
import PublicProfile from "./pages/PublicProfile";
import PublicListDetail from "./pages/PublicListDetail";

import MyList from "./pages/MyList";
import CustomListDetail from "./pages/CustomListDetail";
import Profile from "./pages/Profile";
import Passport from "./pages/Passport";
import Invite from "./pages/Invite";
import NotFound from "./pages/NotFound";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data doesn't need to be refetched every single time a component
      // remounts (e.g. switching tabs) - treat it as fresh for a minute so
      // navigation shows cached data instantly instead of a full spinner.
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Paths PersistentTabs owns (see PersistentTabs.tsx) - their <Route> below
// renders null, so there's nothing worth animating a fade-in for and no
// point remounting the wrapper div when bouncing between them.
const PERSISTENT_TAB_PATHS = new Set(['/foodie', '/my-lists', '/friends', '/explore']);

// Restrained fade+slight-rise on every "real" (non-persistent-tab) route
// change, so navigating to a detail screen, profile, etc. feels like a
// deliberate transition rather than an instant, jarring swap - see the
// route-fade-in keyframes in index.css. Kept out of the persistent tabs
// entirely since those already switch instantly (no remount at all) and a
// wrapping animation would just add pointless motion on top of that.
function AnimatedRoutes() {
  const location = useLocation();
  const fadeKey = PERSISTENT_TAB_PATHS.has(location.pathname) ? 'tab' : location.pathname;

  return (
    <div key={fadeKey} className="route-fade-in">
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/auth" element={<Auth />} />
        {/* Dashboard.tsx was an earlier, less complete version of this
            same page (no edit-after-mark-visited flow, no duplicate
            check, no type ordering, etc.) that MyList.tsx has since
            fully superseded - redirect rather than maintain two
            divergent copies of the same screen. */}
        <Route path="/dashboard" element={<Navigate to="/my-list" replace />} />
        <Route path="/friends" element={null} />
        <Route path="/search" element={<Search />} />
        <Route path="/explore" element={null} />
        <Route path="/u/:userId" element={<PublicProfile />} />
        <Route path="/u/:userId/lists/:listId" element={<PublicListDetail />} />

        {/* News and Recipes used to be their own top-level nav items;
            both now live as tabs inside Foodie (see nav restructure -
            Foodie/My Lists/Friends/Explore). Redirect old links/
            bookmarks rather than keep two ways to reach the same
            content. */}
        <Route path="/news" element={<Navigate to="/foodie" replace />} />
        <Route path="/recipes" element={<Navigate to="/foodie" replace />} />
        <Route path="/foodie" element={null} />
        <Route path="/my-list" element={<MyList />} />
        <Route path="/my-lists" element={null} />
        <Route path="/my-lists/:listId" element={<CustomListDetail />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/passport" element={<Passport />} />
        {/* Invite links resolve here, park the code and redirect - see
            Invite.tsx. Kept outside PersistentTabs since it's a
            pass-through, not a screen. */}
        <Route path="/invite/:code" element={<Invite />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  );
}

/**
 * Owns the native launch handover: keeps the splash screen up until the
 * session check has finished, so the splash gives way to a populated
 * screen rather than to an empty shell that then fills in.
 *
 * Lives inside AuthProvider (it needs useAuth) and renders nothing.
 */
/**
 * Claims a parked invite code once the user has an account.
 *
 * Runs on every sign-in rather than only on sign-up, because the signup
 * flow can round-trip through email verification and land back here as a
 * fresh session. Every rule that decides whether the claim is valid -
 * including "is this account actually new" - lives in claim_referral on
 * the server, so calling it redundantly is safe and simply gets rejected.
 */
function ReferralClaimer() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    if (!readPendingReferral()) return;
    void claimPendingReferral();
  }, [user]);

  return null;
}

function NativeLaunchGate() {
  const { loading } = useAuth();

  // Failsafe: a hung session check must never strand someone on the splash
  // screen indefinitely. Whatever happens, hand over to the UI - a sign-in
  // screen, or even an error, beats staring at a logo forever.
  useEffect(() => {
    const failsafe = window.setTimeout(() => void hideSplashScreen(), 4000);
    return () => window.clearTimeout(failsafe);
  }, []);

  useEffect(() => {
    if (!loading) void hideSplashScreen();
  }, [loading]);

  return null;
}

const App = () => {
  useEffect(() => {
    void configureStatusBar();
    void requestStartupPermissions();
  }, []);

  return (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <NativeLaunchGate />
      <ReferralClaimer />
      <PushNotificationManager />
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <BottomTabBar />
          {/* Renders the four bottom-tab pages itself, kept mounted across
              switches instead of the normal Route mount/unmount cycle below
              (see PersistentTabs.tsx) - the matching routes for their paths
              render nothing so react-router still matches them instead of
              falling through to the catch-all NotFound. */}
          <PersistentTabs />
          <AnimatedRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
  );
};

export default App;
