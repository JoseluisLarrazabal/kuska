import { getDeploymentConfig } from "../../config/deployment";

function explorerBase(): string | undefined {
  return getDeploymentConfig().chain.blockExplorers?.default.url;
}

/** Link al explorer de HSK Chain para una tx, o `undefined` si no hay explorer configurado. */
export function txExplorerUrl(hash: string): string | undefined {
  const base = explorerBase();
  return base ? `${base}/tx/${hash}` : undefined;
}

/** Link al explorer de HSK Chain para una dirección. */
export function addressExplorerUrl(address: string): string | undefined {
  const base = explorerBase();
  return base ? `${base}/address/${address}` : undefined;
}
