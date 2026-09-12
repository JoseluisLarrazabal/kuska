import { afterEach, describe, expect, it, vi } from "vitest";
import { findTrackedOrder, listTrackedOrders, trackOrder, untrackOrder } from "../src/lib/ui/orderRegistry";
import type { Hex } from "viem";

/** `localStorage` en memoria — mismo patrón que `test/burnerStatus.test.ts`. */
function createFakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

const REF_LOWER = `0x${"a".repeat(64)}` as Hex;
const REF_UPPER = `0x${"A".repeat(64)}` as Hex;
const REF_MIXED = `0x${"aB".repeat(32)}` as Hex;

describe("orderRegistry — comparaciones sin distinguir mayúsculas/minúsculas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("trackOrder: un ref guardado en minúsculas se actualiza (no duplica) al trackearlo de nuevo en mayúsculas", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    trackOrder(REF_LOWER, { item: "primero", role: "buyer" });
    trackOrder(REF_UPPER, { item: "actualizado" });

    const all = listTrackedOrders();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ ref: REF_LOWER, item: "actualizado", role: "buyer" });
  });

  it("findTrackedOrder: encuentra un pedido guardado con otra capitalización", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    trackOrder(REF_MIXED, { item: "40 cajas" });

    expect(findTrackedOrder(REF_MIXED.toLowerCase() as Hex)?.item).toBe("40 cajas");
    expect(findTrackedOrder(REF_MIXED.toUpperCase() as Hex)?.item).toBe("40 cajas");
  });

  it("findTrackedOrder: sin match, devuelve undefined", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    expect(findTrackedOrder(REF_LOWER)).toBeUndefined();
  });

  it("untrackOrder: borra el pedido sin importar la capitalización con la que se pida", () => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });

    trackOrder(REF_LOWER, { item: "algo" });
    untrackOrder(REF_UPPER);

    expect(listTrackedOrders()).toHaveLength(0);
  });
});
