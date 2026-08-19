// The real public web domain the app is also deployed to (separate from
// the native app shell) - use this for any link meant to be opened by
// someone else, e.g. a share sheet or a QR code. Never use
// window.location.origin for that purpose: inside the native Capacitor
// WebView it resolves to an internal capacitor://localhost address that
// nothing outside the app can open (see the forgot-password flow, which
// hit this same bug before switching to in-app OTP).
export const SITE_URL = 'https://afiyeat.com';
