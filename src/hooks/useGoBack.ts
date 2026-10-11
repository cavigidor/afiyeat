import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * A screen's back button: return to wherever the user actually came from
 * (Lists, Activity, Home...) when there is an in-app previous screen, and
 * to a sensible parent when the screen was opened directly - a cold-start
 * deep link or a reload, where there's nothing in the app to go back to.
 *
 * React Router gives the first entry of a session the key "default", so
 * that's the reliable "opened directly" signal (window.history.length is
 * not: it counts pages from before the app loaded).
 */
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate(fallback, { replace: true });
  }, [location.key, navigate, fallback]);
}
