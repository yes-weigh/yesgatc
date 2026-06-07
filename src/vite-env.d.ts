/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_WEATHERAPI_KEY?: string;
  /** Google Maps Geocoding API — best match for Google Maps place names on photo stamps. */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_GEOCODING_API_KEY?: string;
  /** Optional legacy — Razorpay checkout uses keyId from Cloud Functions. */
  readonly VITE_RAZORPAY_KEY_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
