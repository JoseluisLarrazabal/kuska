import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatEther, type Address } from "viem";
import { Layout } from "../lib/ui/components/Layout";
import { Button } from "../lib/ui/components/Button";
import { Banner } from "../lib/ui/components/Banner";
import { AddressMono } from "../lib/ui/components/AddressMono";
import { AmountMono } from "../lib/ui/components/AmountMono";
import { DropletIcon } from "../lib/ui/components/Icon";
import { getAccount, getOrCreateAccount } from "../lib/burner";
import { getDeploymentConfig } from "../config/deployment";
import { getPublicClient } from "../lib/ui/viemClient";
import { getTokenBalance } from "../lib/ui/token";
import { getHealth, postFaucet } from "../lib/ui/relayer";
import { createOrder } from "../lib/ui/depositFlow";
import { listTrackedOrders, trackOrder, type TrackedOrder } from "../lib/ui/orderRegistry";
import { formatUnixTime } from "../lib/ui/format";

/** Saldo mínimo de HSK para pagar gas (docs/escrow-interface.md §6). */
const LOW_BALANCE_WEI = 20_000_000_000_000_000n; // 0.02 HSK

interface RoleBalance {
  label: string;
  address: Address;
  hsk: bigint;
  musd: bigint;
}

function useRoleBalances() {
  const { tokenAddress, demoSeller } = getDeploymentConfig();
  const burner = getAccount();

  return useQuery({
    queryKey: ["demo-balances", burner?.address ?? null],
    queryFn: async (): Promise<{ health: Awaited<ReturnType<typeof getHealth>>; roles: RoleBalance[] }> => {
      const client = getPublicClient();
      const health = await getHealth();

      const targets: Array<{ label: string; address: Address }> = [
        { label: "Vendedor de demo", address: demoSeller },
      ];
      if (burner) targets.push({ label: "Tu cuenta local", address: burner.address });

      const roles = await Promise.all(
        targets.map(async (t) => {
          const [hsk, musd] = await Promise.all([
            client.getBalance({ address: t.address }),
            getTokenBalance(client, tokenAddress, t.address),
          ]);
          return { ...t, hsk, musd };
        }),
      );

      return { health, roles };
    },
    refetchInterval: 8000,
  });
}

export default function Demo() {
  const { data, refetch } = useRoleBalances();
  const [faucetTarget, setFaucetTarget] = useState<"local" | "seller">("local");
  const [faucetStatus, setFaucetStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [faucetMessage, setFaucetMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState<"normal" | "refund" | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [demoOrders, setDemoOrders] = useState<TrackedOrder[]>(() =>
    listTrackedOrders().filter((o) => o.role === "demo"),
  );

  const { demoSeller } = getDeploymentConfig();

  async function requestFaucet() {
    setFaucetStatus("loading");
    setFaucetMessage(null);
    const target = faucetTarget === "local" ? getOrCreateAccount().address : demoSeller;
    const outcome = await postFaucet(target);
    if (outcome.ok) {
      setFaucetStatus("done");
      setFaucetMessage("Listo: se acreditaron 100 mUSD (demo).");
      refetch();
    } else {
      setFaucetStatus("error");
      setFaucetMessage(
        outcome.code === "FAUCET_COOLDOWN" && outcome.availableAt
          ? `${outcome.message} Disponible a las ${formatUnixTime(outcome.availableAt)}.`
          : outcome.message,
      );
    }
  }

  async function armDemoDeal(kind: "normal" | "refund") {
    setCreating(kind);
    setCreateError(null);
    try {
      const buyer = getOrCreateAccount();
      const { orderRef, outcome } = await createOrder({
        buyer,
        seller: demoSeller,
        amount: 25_000_000n, // 25.00 mUSD (demo)
        deliverySeconds: kind === "refund" ? 120 : 1800,
      });
      if (!outcome.ok) {
        setCreateError(outcome.error.message);
      } else {
        trackOrder(orderRef, { role: "demo", item: kind === "refund" ? "Deal de reembolso (demo)" : "Deal normal (demo)" });
        setDemoOrders(listTrackedOrders().filter((o) => o.role === "demo"));
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "No se pudo armar el deal de demo.");
    } finally {
      setCreating(null);
    }
  }

  const lowBalanceRoles = [
    ...(data?.health?.lowBalance ? ["Relayer"] : []),
    ...(data?.roles.filter((r) => r.hsk < LOW_BALANCE_WEI).map((r) => r.label) ?? []),
  ];

  return (
    <Layout>
      <h1 className="mt-6 font-display text-[26px] font-medium text-verde">Panel de demo</h1>
      <p className="mt-1 text-sm text-verde-mut">
        Direcciones, saldos y atajos para la demo en vivo.
      </p>

      {lowBalanceRoles.length > 0 ? (
        <Banner kind="warning" title="Saldo de gas bajo" className="mt-4">
          {lowBalanceRoles.join(", ")} {lowBalanceRoles.length === 1 ? "tiene" : "tienen"} menos
          de 0,02 HSK. Puede fallar el envío de transacciones.
        </Banner>
      ) : null}

      <section className="mt-5 flex flex-col gap-3">
        {data?.health ? (
          <RoleRow
            label="Relayer"
            address={data.health.relayer}
            hsk={data.health.relayerBalanceWei}
            musd={undefined}
          />
        ) : null}
        {data?.roles.map((role) => (
          <RoleRow key={role.address} label={role.label} address={role.address} hsk={role.hsk} musd={role.musd} />
        ))}
        {!getAccount() ? (
          <p className="text-sm text-verde-mut">
            Todavía no tenés una cuenta local en este dispositivo. Se crea automáticamente
            en <Link to="/comprar" className="underline">Comprar</Link> o{" "}
            <Link to="/vendedor" className="underline">Vendedor</Link>.
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-card bg-blanco p-4">
        <h2 className="text-[16px] font-semibold text-verde">Faucet de mUSD (demo)</h2>
        <div className="mt-2 flex gap-2">
          <label className="flex min-h-11 items-center gap-1.5 text-sm text-verde">
            <input
              type="radio"
              name="faucet-target"
              checked={faucetTarget === "local"}
              onChange={() => setFaucetTarget("local")}
              className="h-4 w-4"
            />
            Tu cuenta local
          </label>
          <label className="flex min-h-11 items-center gap-1.5 text-sm text-verde">
            <input
              type="radio"
              name="faucet-target"
              checked={faucetTarget === "seller"}
              onChange={() => setFaucetTarget("seller")}
              className="h-4 w-4"
            />
            Vendedor de demo
          </label>
        </div>
        <Button className="mt-3 w-full" busy={faucetStatus === "loading"} onClick={requestFaucet}>
          <DropletIcon size={16} />
          Pedir 100 mUSD (demo)
        </Button>
        {faucetMessage ? (
          <p className={`mt-2 text-sm ${faucetStatus === "error" ? "text-terracota" : "text-verde-mut"}`}>
            {faucetMessage}
          </p>
        ) : null}
      </section>

      <section className="mt-6 rounded-card bg-blanco p-4">
        <h2 className="text-[16px] font-semibold text-verde">Deals pre-armados</h2>
        <p className="mt-1 text-sm text-verde-mut">
          Fondea automáticamente con tu cuenta local como comprador y el vendedor de demo.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <Button busy={creating === "normal"} onClick={() => armDemoDeal("normal")}>
            Armar deal normal (30 min de entrega)
          </Button>
          <Button variant="secondary" busy={creating === "refund"} onClick={() => armDemoDeal("refund")}>
            Armar deal de reembolso (vence en 2 min)
          </Button>
        </div>
        {createError ? (
          <Banner kind="error" className="mt-3">
            {createError}
          </Banner>
        ) : null}
        {demoOrders.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2">
            {demoOrders.map((order) => (
              <li key={order.ref} className="flex items-center justify-between text-sm">
                <span className="text-verde-mut">{order.item}</span>
                <Link to={`/pedido/${order.ref}`} className="font-medium text-verde underline">
                  Ver pedido
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </Layout>
  );
}

function RoleRow({
  label,
  address,
  hsk,
  musd,
}: {
  label: string;
  address: Address;
  hsk: bigint;
  musd: bigint | undefined;
}) {
  const low = hsk < LOW_BALANCE_WEI;
  return (
    <div className="rounded-card bg-blanco p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-verde">{label}</span>
        <AddressMono address={address} />
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className={low ? "font-semibold text-terracota" : "text-verde-mut"}>
          {formatEther(hsk)} HSK{low ? " · bajo" : ""}
        </span>
        {musd !== undefined ? <AmountMono amount={musd} size="sm" /> : null}
      </div>
    </div>
  );
}
