import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { ensureDemoFunds } from "../src/lib/ui/ensureDemoFunds";
import type { FaucetOutcome } from "../src/lib/ui/relayer";

const AMOUNT = 25_000_000n; // 25.00 mUSD (demo)

function okFaucet(hash: Hex = "0xaaaa" as Hex): FaucetOutcome {
  return { ok: true, hash };
}

describe("ensureDemoFunds", () => {
  it("saldo ya suficiente: no llama al faucet ni a onFunding", async () => {
    const getBalance = vi.fn().mockResolvedValue(AMOUNT);
    const requestFaucet = vi.fn().mockResolvedValue(okFaucet());
    const onFunding = vi.fn();

    const result = await ensureDemoFunds({ amount: AMOUNT, getBalance, requestFaucet, onFunding });

    expect(result).toEqual({ ok: true, funded: false });
    expect(requestFaucet).not.toHaveBeenCalled();
    expect(onFunding).not.toHaveBeenCalled();
    expect(getBalance).toHaveBeenCalledTimes(1);
  });

  it("saldo insuficiente + faucet ok + saldo visible en la primera relectura", async () => {
    const getBalance = vi
      .fn()
      .mockResolvedValueOnce(0n) // lectura inicial: insuficiente
      .mockResolvedValueOnce(AMOUNT); // primera relectura tras el faucet: ya alcanza
    const requestFaucet = vi.fn().mockResolvedValue(okFaucet());
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onFunding = vi.fn();

    const result = await ensureDemoFunds({ amount: AMOUNT, getBalance, requestFaucet, sleep, onFunding });

    expect(result).toEqual({ ok: true, funded: true });
    expect(requestFaucet).toHaveBeenCalledTimes(1);
    expect(onFunding).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(getBalance).toHaveBeenCalledTimes(2);
  });

  it("saldo insuficiente + faucet ok + saldo aparece recién tras N relecturas", async () => {
    const getBalance = vi
      .fn()
      .mockResolvedValueOnce(0n) // lectura inicial
      .mockResolvedValueOnce(0n) // poll 1: todavía no
      .mockResolvedValueOnce(0n) // poll 2: todavía no
      .mockResolvedValueOnce(AMOUNT); // poll 3: ya alcanza
    const requestFaucet = vi.fn().mockResolvedValue(okFaucet());
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await ensureDemoFunds({
      amount: AMOUNT,
      getBalance,
      requestFaucet,
      sleep,
      maxPolls: 6,
      pollMs: 1000,
    });

    expect(result).toEqual({ ok: true, funded: true });
    expect(getBalance).toHaveBeenCalledTimes(4);
    // Durmió tras los dos primeros polls fallidos; el tercero ya encontró
    // saldo suficiente y devolvió sin dormir de nuevo.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("falla del faucet (cooldown): devuelve el outcome y nunca hace polling", async () => {
    const getBalance = vi.fn().mockResolvedValue(0n);
    const cooldown: FaucetOutcome = {
      ok: false,
      code: "FAUCET_COOLDOWN",
      message: "El faucet tiene un enfriamiento de 1 hora: todavía no podés volver a pedir fondos.",
      availableAt: 1_700_000_000,
    };
    const requestFaucet = vi.fn().mockResolvedValue(cooldown);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await ensureDemoFunds({ amount: AMOUNT, getBalance, requestFaucet, sleep });

    expect(result).toEqual({ ok: false, reason: "faucet_failed", faucet: cooldown });
    expect(sleep).not.toHaveBeenCalled();
    // Solo la lectura inicial: nunca releyó el saldo tras el faucet fallido.
    expect(getBalance).toHaveBeenCalledTimes(1);
  });

  it("el saldo nunca aparece: balance_not_visible tras agotar maxPolls", async () => {
    const getBalance = vi.fn().mockResolvedValue(0n); // siempre insuficiente
    const requestFaucet = vi.fn().mockResolvedValue(okFaucet());
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await ensureDemoFunds({
      amount: AMOUNT,
      getBalance,
      requestFaucet,
      sleep,
      maxPolls: 3,
      pollMs: 500,
    });

    expect(result).toEqual({ ok: false, reason: "balance_not_visible" });
    // 1 lectura inicial + 3 polls = 4.
    expect(getBalance).toHaveBeenCalledTimes(4);
    // Durmió entre polls, pero no después del último intento fallido.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("onFunding se llama solo cuando hace falta fondear, nunca si el saldo ya alcanzaba", async () => {
    const getBalance = vi.fn().mockResolvedValue(AMOUNT + 1n);
    const requestFaucet = vi.fn().mockResolvedValue(okFaucet());
    const onFunding = vi.fn();

    await ensureDemoFunds({ amount: AMOUNT, getBalance, requestFaucet, onFunding });

    expect(onFunding).not.toHaveBeenCalled();
  });

  it("un poll tira (RPC caído/429) y el siguiente encuentra saldo: sigue reintentando, no aborta", async () => {
    const getBalance = vi
      .fn()
      .mockResolvedValueOnce(0n) // lectura inicial: insuficiente
      .mockRejectedValueOnce(new Error("RPC caído")) // poll 1: tira
      .mockResolvedValueOnce(AMOUNT); // poll 2: ya alcanza
    const requestFaucet = vi.fn().mockResolvedValue(okFaucet());
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await ensureDemoFunds({
      amount: AMOUNT,
      getBalance,
      requestFaucet,
      sleep,
      maxPolls: 6,
      pollMs: 1000,
    });

    expect(result).toEqual({ ok: true, funded: true });
    expect(getBalance).toHaveBeenCalledTimes(3);
  });

  it("todos los polls tiran: agota maxPolls y devuelve balance_not_visible en vez de rechazar", async () => {
    const getBalance = vi
      .fn()
      .mockResolvedValueOnce(0n) // lectura inicial: insuficiente
      .mockRejectedValue(new Error("RPC caído")); // todos los polls tiran
    const requestFaucet = vi.fn().mockResolvedValue(okFaucet());
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await ensureDemoFunds({
      amount: AMOUNT,
      getBalance,
      requestFaucet,
      sleep,
      maxPolls: 3,
      pollMs: 500,
    });

    expect(result).toEqual({ ok: false, reason: "balance_not_visible" });
    // 1 lectura inicial + 3 polls (todos rechazados) = 4.
    expect(getBalance).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("la lectura INICIAL tira: rechaza (no se trata como 'no visible') y el faucet nunca se pide", async () => {
    const getBalance = vi.fn().mockRejectedValueOnce(new Error("RPC caído"));
    const requestFaucet = vi.fn().mockResolvedValue(okFaucet());

    await expect(
      ensureDemoFunds({ amount: AMOUNT, getBalance, requestFaucet }),
    ).rejects.toThrow("RPC caído");
    expect(requestFaucet).not.toHaveBeenCalled();
  });
});
