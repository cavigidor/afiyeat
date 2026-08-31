import { useCallback, useEffect, useState } from 'react';
import { isNative, getCurrentPosition, type Coords } from '@/lib/native';

export type LocationPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

// Tracks geolocation permission state and exposes a single requestLocation()
// entry point, so every map/location-aware screen answers "did the user
// already say no" the same way instead of each guessing from its own
// failed getCurrentPosition() call.
export function useLocationPermission() {
  const [state, setState] = useState<LocationPermissionState>('prompt');

  const checkPermission = useCallback(async (): Promise<LocationPermissionState> => {
    try {
      if (isNative()) {
        const { Geolocation } = await import('@capacitor/geolocation');
        const perm = await Geolocation.checkPermissions();
        const granted = perm.location === 'granted' || perm.coarseLocation === 'granted';
        const denied = perm.location === 'denied' && perm.coarseLocation === 'denied';
        const next: LocationPermissionState = granted ? 'granted' : denied ? 'denied' : 'prompt';
        setState(next);
        return next;
      }
      if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
        const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
        const next = status.state as LocationPermissionState;
        setState(next);
        return next;
      }
    } catch (err) {
      console.error('checkPermission failed:', err);
    }
    setState('unsupported');
    return 'unsupported';
  }, []);

  useEffect(() => {
    checkPermission();
  }, [checkPermission]);

  // Requests the device's location, never throwing - callers get back
  // whatever coords resolved (or null) plus wasDenied, which is only true
  // when a fresh permission check right after the failure confirms it was
  // an actual denial and not e.g. GPS being off or a timeout. That lets
  // callers show a "please enable location in Settings" prompt only when
  // it's actually the right ask.
  const requestLocation = useCallback(async (): Promise<{ coords: Coords | null; wasDenied: boolean }> => {
    try {
      const coords = await getCurrentPosition();
      setState('granted');
      return { coords, wasDenied: false };
    } catch (err) {
      const next = await checkPermission();
      return { coords: null, wasDenied: next === 'denied' };
    }
  }, [checkPermission]);

  return { state, requestLocation, checkPermission };
}
