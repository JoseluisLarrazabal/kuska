import { BaseError, ContractFunctionRevertedError } from "viem";

/** Si `err` envuelve un revert de contrato (custom error), devuelve ese error decodificado. */
export function findRevertedError(err: unknown): ContractFunctionRevertedError | undefined {
  if (err instanceof BaseError) {
    const found = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (found instanceof ContractFunctionRevertedError) return found;
  }
  return undefined;
}

/** Heurística: ¿el error del RPC es por un nonce desincronizado? */
export function isNonceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /nonce/i.test(message);
}
