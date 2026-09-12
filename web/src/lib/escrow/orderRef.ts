import { keccak256, toBytes } from "viem";
import type { Hex } from "viem";

/**
 * `orderRef` = keccak256(toBytes(crypto.randomUUID())), generado por el
 * comprador (docs/escrow-interface.md §4). Usa la Web Crypto API global,
 * disponible tanto en navegadores modernos como en Node 19+.
 */
export function newOrderRef(): Hex {
  return keccak256(toBytes(crypto.randomUUID()));
}
