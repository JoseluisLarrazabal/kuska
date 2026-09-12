/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID: string;
  readonly VITE_ESCROW_ADDRESS: string;
  readonly VITE_TOKEN_ADDRESS: string;
  readonly VITE_DEPLOY_BLOCK: string;
  readonly VITE_DEMO_SELLER: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
