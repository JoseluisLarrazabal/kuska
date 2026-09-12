import { describe, expect, it } from "vitest";
import { DealState } from "../src/lib/escrow/read";
import {
  canOpenDisputeWindow,
  canReleaseAfterWindow,
  canRequestRefund,
  disputeTapDecision,
} from "../src/lib/ui/dealTiming";

describe("canRequestRefund", () => {
  const deal = { state: DealState.Funded, deliveryDeadline: 1000n };

  it("false antes del deadline", () => {
    expect(canRequestRefund(deal, "buyer", 999)).toBe(false);
  });

  it("false justo en el deadline (estrictamente mayor, igual que el contrato)", () => {
    expect(canRequestRefund(deal, "buyer", 1000)).toBe(false);
  });

  it("true un segundo después del deadline", () => {
    expect(canRequestRefund(deal, "buyer", 1001)).toBe(true);
  });

  it("false si el rol no es buyer", () => {
    expect(canRequestRefund(deal, "seller", 1001)).toBe(false);
    expect(canRequestRefund(deal, undefined, 1001)).toBe(false);
  });

  it("false si el deal no está Funded", () => {
    expect(canRequestRefund({ state: DealState.DeliveryClaimed, deliveryDeadline: 1000n }, "buyer", 1001)).toBe(false);
  });
});

describe("canOpenDisputeWindow", () => {
  it("false sin disputeDeadline", () => {
    expect(canOpenDisputeWindow(undefined, false, 500)).toBe(false);
  });

  it("mientras el disputeWindow es una adivinanza, se mantiene disponible aunque el guess diga que ya venció", () => {
    expect(canOpenDisputeWindow(1000n, true, 2000)).toBe(true);
  });

  it("una vez confirmado, true estrictamente antes del deadline", () => {
    expect(canOpenDisputeWindow(1000n, false, 999)).toBe(true);
  });

  it("una vez confirmado, false justo en el deadline y después", () => {
    expect(canOpenDisputeWindow(1000n, false, 1000)).toBe(false);
    expect(canOpenDisputeWindow(1000n, false, 1001)).toBe(false);
  });
});

describe("canReleaseAfterWindow", () => {
  it("false sin disputeDeadline", () => {
    expect(canReleaseAfterWindow(undefined, false, 2000)).toBe(false);
  });

  it("nunca se ofrece mientras el disputeWindow es una adivinanza, aunque el guess diga que ya venció", () => {
    expect(canReleaseAfterWindow(1000n, true, 2000)).toBe(false);
  });

  it("una vez confirmado, false antes del deadline", () => {
    expect(canReleaseAfterWindow(1000n, false, 999)).toBe(false);
  });

  it("una vez confirmado, true justo en el deadline (inclusive) y después", () => {
    expect(canReleaseAfterWindow(1000n, false, 1000)).toBe(true);
    expect(canReleaseAfterWindow(1000n, false, 1001)).toBe(true);
  });
});

describe("disputeTapDecision", () => {
  const minMs = 500;
  const windowMs = 5000;

  it("primer toque (no armado) arma", () => {
    expect(disputeTapDecision({ armed: false, armedAt: null, now: 10_000, minMs, windowMs })).toBe(
      "arm",
    );
  });

  it("segundo toque rápido (< minMs desde que se armó) se ignora", () => {
    expect(
      disputeTapDecision({ armed: true, armedAt: 10_000, now: 10_100, minMs, windowMs }),
    ).toBe("ignore");
  });

  it("segundo toque deliberado (entre minMs y windowMs) ejecuta", () => {
    expect(
      disputeTapDecision({ armed: true, armedAt: 10_000, now: 10_500, minMs, windowMs }),
    ).toBe("execute");
    expect(
      disputeTapDecision({ armed: true, armedAt: 10_000, now: 12_000, minMs, windowMs }),
    ).toBe("execute");
  });

  it("toque después de la ventana (> windowMs) re-arma en vez de ejecutar", () => {
    expect(
      disputeTapDecision({ armed: true, armedAt: 10_000, now: 15_001, minMs, windowMs }),
    ).toBe("arm");
  });
});
