/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly VITE_ENABLE_DEMO_DATA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
