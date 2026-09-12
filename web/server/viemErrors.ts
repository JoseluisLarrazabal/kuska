import {
  BaseError,
  ContractFunctionRevertedError,
  NonceMaxValueError,
  NonceTooHighError,
  NonceTooLowError,
} from "viem";

/** Si `err` envuelve un revert de contrato (custom error), devuelve ese error decodificado. */
export function findRevertedError(err: unknown): ContractFunctionRevertedError | undefined {
  if (err instanceof BaseError) {
    const found = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (found instanceof ContractFunctionRevertedError) return found;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// isNonceError: ¿vale la pena reintentar `writeContract` con un nonce
// "pending" fresco?
//
// NO se puede matchear esto sobre `err.message`: `TransactionExecutionError`
// (la clase que envuelve CUALQUIER fallo de `writeContract`) concatena los
// "Request Arguments" —incluido el propio `nonce`, que `writeWithNonceRetry`
// siempre pasa explícito— a su `.message` vía `metaMessages`
// (node_modules/viem/_esm/errors/transaction.js, clase
// `TransactionExecutionError`, confirmado leyendo el código instalado). Eso
// significa que el `.message` de CUALQUIER error de write —un `insufficient
// funds for gas`, un timeout HTTP en `eth_sendRawTransaction`, lo que sea—
// contiene la palabra "nonce", y un `/nonce/i.test(message)` siempre da
// `true`. Si esa heurística dispara un reintento sobre un error que NO es de
// nonce, y el nodo ya había aceptado la primera tx, la "reintentada" es una
// tx nueva, no un reemplazo: el relayer paga el gas dos veces.
//
// En su lugar, se detecta por TIPO. viem ya clasifica los errores de nonce
// del nodo como `NonceTooLowError` / `NonceTooHighError` / `NonceMaxValueError`
// (ver utils/errors/getNodeError.js), que quedan colgados en algún punto de la
// cadena `.cause` de `TransactionExecutionError`. Se camina esa cadena con
// `BaseError.walk` para encontrarlos sin importar cuántas capas de wrapping
// tengan.
//
// "replacement transaction underpriced" (reemplazo de una tx pendiente) se
// resuelve igual —pedir un nonce pending fresco—, pero la versión de viem
// instalada no tiene una clase dedicada para ese caso: el error crudo del
// nodo (p. ej. `RpcRequestError`) queda como `cause` sin reclasificar. Como
// red secundaria, para cada nodo de la cadena se mira `shortMessage` y
// `details` (NUNCA `.message` completo): son los campos de `BaseError` que
// contienen el mensaje corto / el detalle crudo del RPC sin los
// `metaMessages`/request args que contaminan `.message`.
// ---------------------------------------------------------------------------

const REPLACEMENT_UNDERPRICED_RE = /replacement.*underpriced/i;

function isNonceErrorNode(e: unknown): boolean {
  if (
    e instanceof NonceTooLowError ||
    e instanceof NonceTooHighError ||
    e instanceof NonceMaxValueError
  ) {
    return true;
  }
  if (e instanceof BaseError) {
    return (
      REPLACEMENT_UNDERPRICED_RE.test(e.shortMessage ?? "") ||
      REPLACEMENT_UNDERPRICED_RE.test(e.details ?? "")
    );
  }
  return false;
}

export function isNonceError(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  return err.walk(isNonceErrorNode) !== null;
}
