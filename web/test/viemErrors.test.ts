import { describe, expect, it } from "vitest";
import {
  type BaseError,
  InsufficientFundsError,
  NonceMaxValueError,
  NonceTooHighError,
  NonceTooLowError,
  RpcRequestError,
  TransactionExecutionError,
} from "viem";
import { isNonceError } from "../server/viemErrors";

// ---------------------------------------------------------------------------
// Fix ALTO 1: `isNonceError` NO puede matchear sobre `err.message`, porque
// `TransactionExecutionError` concatena los "Request Arguments" (incluido el
// `nonce`, que `writeWithNonceRetry` siempre pasa explícito) en su
// `.message` — así que el `.message` de CUALQUIER error de write contiene
// "nonce", nonce o no. Estos tests construyen los errores tal cual los tira
// viem de verdad (`TransactionExecutionError` envolviendo la causa
// reclasificada por `getNodeError`), no `new Error("...")` planos.
// ---------------------------------------------------------------------------

function wrap(cause: BaseError, nonce?: number): TransactionExecutionError {
  return new TransactionExecutionError(cause, {
    account: null,
    ...(nonce !== undefined ? { nonce } : {}),
  });
}

describe("isNonceError", () => {
  it("true para NonceTooLowError (envuelto en TransactionExecutionError)", () => {
    expect(isNonceError(wrap(new NonceTooLowError({ nonce: 5 }), 5))).toBe(true);
  });

  it("true para NonceTooHighError", () => {
    expect(isNonceError(wrap(new NonceTooHighError({ nonce: 5 }), 5))).toBe(true);
  });

  it("true para NonceMaxValueError", () => {
    expect(isNonceError(wrap(new NonceMaxValueError({ nonce: 5 }), 5))).toBe(true);
  });

  it("true para 'replacement transaction underpriced' (sin clase dedicada en esta versión de viem)", () => {
    const rpcError = new RpcRequestError({
      body: { method: "eth_sendRawTransaction" },
      error: { code: -32000, message: "replacement transaction underpriced" },
      url: "https://testnet.hsk.xyz",
    });
    expect(isNonceError(wrap(rpcError))).toBe(true);
  });

  it("false para InsufficientFundsError, aunque el `.message` completo contenga 'nonce' (request args)", () => {
    const err = wrap(new InsufficientFundsError({}), 5);
    // confirma la premisa del bug: el `.message` sí contiene "nonce:" por los
    // request args, y sin embargo esto NO debe tratarse como error de nonce.
    expect(err.message).toMatch(/nonce/i);
    expect(isNonceError(err)).toBe(false);
  });

  it("false para un error de red genérico sin relación con nonces", () => {
    const rpcError = new RpcRequestError({
      body: { method: "eth_sendRawTransaction" },
      error: { code: -32603, message: "internal error" },
      url: "https://testnet.hsk.xyz",
    });
    expect(isNonceError(wrap(rpcError, 5))).toBe(false);
  });

  it("false para un valor que no es un BaseError de viem", () => {
    expect(isNonceError(new Error("nonce too low"))).toBe(false);
    expect(isNonceError("nonce too low")).toBe(false);
    expect(isNonceError(undefined)).toBe(false);
  });
});
