import { BaseError, ContractFunctionRevertedError } from "viem";

/** Si `err` envuelve un revert de contrato (custom error), devuelve ese error decodificado. */
export function findRevertedError(err: unknown): ContractFunctionRevertedError | undefined {
  if (err instanceof BaseError) {
    const found = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (found instanceof ContractFunctionRevertedError) return found;
  }
  return undefined;
}

/**
 * Heurística: ¿el error del RPC amerita reintentar con un nonce "pending"
 * fresco? Cubre errores de nonce desincronizado ("nonce too low", "nonce too
 * high", etc., todos contienen "nonce") y de reemplazo de tx pendiente
 * ("replacement transaction underpriced" / "replacement underpriced"), que no
 * contienen la palabra "nonce" pero se resuelven de la misma forma: pedir un
 * nonce "pending" nuevo y reintentar.
 */
export function isNonceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /nonce/i.test(message) || /replacement.*underpriced/i.test(message);
}
