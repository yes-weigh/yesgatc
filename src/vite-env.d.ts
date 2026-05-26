/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEATHERAPI_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
