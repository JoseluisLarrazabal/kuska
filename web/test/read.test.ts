import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { DealState, dealStateLabels, getDeal } from "../src/lib/escrow/read";

const ESCROW_ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const ORDER_REF = ("0x" + "aa".repeat(32)) as `0x${string}`;

function dealWithState(state: number) {
  return {
    buyer: "0x3333333333333333333333333333333333333333",
    amount: 1_000_000n,
    seller: "0x4444444444444444444444444444444444444444",
    deliveryDeadline: 1_893_456_000n,
    claimedAt: 0n,
    state,
  };
}

describe("getDeal", () => {
  it("stateLabel es el label documentado para un estado válido (0..5)", async () => {
    const publicClient = {
      readContract: vi.fn().mockResolvedValue(dealWithState(DealState.Funded)),
    };

    const deal = await getDeal(publicClient as unknown as PublicClient, ESCROW_ADDRESS, ORDER_REF);

    expect(deal.state).toBe(DealState.Funded);
    expect(deal.stateLabel).toBe(dealStateLabels[DealState.Funded]);
    expect(deal.stateLabel).toBe("En custodia");
  });

  // -- fix BAJO 9: stateLabel nunca `undefined` ----------------------------

  it("stateLabel es un string legible (no `undefined`) para un `state` fuera de rango (0..5)", async () => {
    const publicClient = {
      readContract: vi.fn().mockResolvedValue(dealWithState(7)),
    };

    const deal = await getDeal(publicClient as unknown as PublicClient, ESCROW_ADDRESS, ORDER_REF);

    expect(deal.stateLabel).not.toBeUndefined();
    expect(typeof deal.stateLabel).toBe("string");
    expect(deal.stateLabel).toContain("7");
  });
});
