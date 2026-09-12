import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { Address, Hex } from "viem";
import { Layout } from "../lib/ui/components/Layout";
import { Button } from "../lib/ui/components/Button";
import { Banner } from "../lib/ui/components/Banner";
import { AddressMono } from "../lib/ui/components/AddressMono";
import { AmountMono } from "../lib/ui/components/AmountMono";
import { HashMono } from "../lib/ui/components/HashMono";
import { DropletIcon } from "../lib/ui/components/Icon";
import {
  getAccount,
  getKeyHistory,
  getOrCreateAccount,
  importAccount,
  previewAccountFromKey,
  restorePreviousAccount,
} from "../lib/burner";
import { getDeploymentConfig } from "../config/deployment";
import { getPublicClient } from "../lib/ui/viemClient";
import { kuskaEscrowAbi } from "../lib/escrow/abi";
import { getTokenBalance } from "../lib/ui/token";
import { getHealth, postFaucet, relayErrorMaybeSentTx } from "../lib/ui/relayer";
import { createOrder } from "../lib/ui/depositFlow";
import { listTrackedOrders, trackOrder, type TrackedOrder } from "../lib/ui/orderRegistry";
import { capItem } from "../lib/ui/orderLink";
import { formatHskAmount, formatUnixTime } from "../lib/ui/format";
import { txExplorerUrl } from "../lib/ui/explorer";

/** Saldo mínimo de HSK para pagar gas (docs/escrow-interface.md §6). */
const LOW_BALANCE_WEI = 20_000_000_000_000_000n; // 0.02 HSK

interface RoleBalance {
  label: string;
  address: Address;
  hsk: bigint;
  musd: bigint;
}

function useRoleBalances() {
  const { tokenAddress, demoSeller, escrowAddress } = getDeploymentConfig();
  const burner = getAccount();

  return useQuery({
    queryKey: ["demo-balances", burner?.address ?? null],
    queryFn: async (): Promise<{
      health: Awaited<ReturnType<typeof getHealth>>;
      roles: RoleBalance[];
      arbiter: Address;
    }> => {
      const client = getPublicClient();
      const [health, arbiter] = await Promise.all([
        getHealth(),
        client.readContract({
          address: escrowAddress,
          abi: kuskaEscrowAbi,
          functionName: "arbiter",
        }),
      ]);

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

      return { health, roles, arbiter };
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
  // Referencia de un deal de demo cuya falla pudo haber mandado (o dejado
  // pendiente de confirmar) la transacción igual (`relayErrorMaybeSentTx`) —
  // mismo problema que `Buy.tsx` ya arregla, replicado acá: sin esto, un
  // timeout/`TX_REVERTED` armando un deal de demo perdía el `orderRef` para
  // siempre y un reintento fondeaba un segundo pedido encima de fondos que
  // podían haber quedado en custodia sin que nadie los viera.
  const [ambiguousDemoOrder, setAmbiguousDemoOrder] = useState<
    { ref: Hex; hash?: string; item: string } | null
  >(null);
  const [importKeyInput, setImportKeyInput] = useState("");
  const [importStatus, setImportStatus] = useState<"idle" | "done" | "error">("idle");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  // Llave validada que espera confirmación explícita porque reemplazaría una
  // identidad con estado (pedidos como comprador o saldo de mUSD) — ver
  // `handleImportKey`/`doImportKey` más abajo.
  const [pendingImportKey, setPendingImportKey] = useState<string | null>(null);

  const { demoSeller } = getDeploymentConfig();
  // `sellerIsArbiter`: ¿el vendedor de demo configurado (VITE_DEMO_SELLER)
  // es la MISMA dirección que el árbitro del contrato? Si coinciden, el
  // árbitro terminaría siendo juez y parte — ver el comentario en
  // `.env.example` sobre VITE_DEMO_SELLER. Verificado: el código compara
  // arbiter vs. demoSeller y el mensaje de abajo describe exactamente esa
  // comparación, así que código y texto ya estaban de acuerdo (no había bug
  // en este par); se deja igual, solo documentado.
  const sellerIsArbiter =
    !!data?.arbiter && data.arbiter.toLowerCase() === demoSeller.toLowerCase();
  // Este dispositivo es, hoy, la identidad del vendedor de demo: dato clave
  // para confirmar de un vistazo antes del pitch en vivo (punto 4 del brief).
  const localAccount = getAccount();
  const deviceIsDemoSeller =
    !!localAccount && localAccount.address.toLowerCase() === demoSeller.toLowerCase();
  const previousAddresses = getKeyHistory();
  // ¿Este dispositivo ya tiene estado como comprador (pedidos armados, o
  // saldo de mUSD) que se quedaría sin firmante si se reemplaza la llave
  // local ahora? Los deals de "demo" también usan la cuenta local como
  // comprador (`armDemoDeal`), así que cuentan igual que los de "buyer" — y
  // eso incluye el pedido de `ambiguousDemoOrder` una vez trackeado más abajo.
  const hasTrackedBuyerOrders = listTrackedOrders().some((o) => o.role === "buyer" || o.role === "demo");
  const localMusd = localAccount
    ? data?.roles.find((r) => r.address.toLowerCase() === localAccount.address.toLowerCase())?.musd
    : undefined;
  const localHasRiskyState = hasTrackedBuyerOrders || (localMusd ?? 0n) > 0n;

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
    // Guarda de reentrancia: dos deals armados a la vez leían el mismo nonce
    // de permit y colisionaban (bug de doble click). `creating !== null`
    // también deshabilita ambos botones (ver el render más abajo), esto es
    // una segunda barrera por si el click llega antes del re-render.
    if (creating !== null || deviceIsDemoSeller) return;
    setCreating(kind);
    setCreateError(null);
    setAmbiguousDemoOrder(null);
    // Capturado una sola vez acá: es el label que efectivamente se trackea
    // para este deal, tanto si falla ambiguo como si sale bien — evita que
    // `ambiguousDemoOrder` (y su link de recuperación) queden sin `item`.
    const item = kind === "refund" ? "Deal de reembolso (demo)" : "Deal normal (demo)";
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
        // Misma clasificación que `Buy.tsx`: la falla puede haber llegado
        // DESPUÉS de mandar la tx (p. ej. un 504 RECEIPT_TIMEOUT). Sin
        // trackear el pedido acá, el `orderRef` se perdía para siempre y un
        // reintento fondeaba un segundo pedido encima de fondos que podían
        // haber quedado en custodia.
        if (relayErrorMaybeSentTx(outcome.error)) {
          trackOrder(orderRef, { role: "demo", item });
          setAmbiguousDemoOrder({ ref: orderRef, hash: outcome.error.hash, item });
          setDemoOrders(listTrackedOrders().filter((o) => o.role === "demo"));
        }
      } else {
        trackOrder(orderRef, { role: "demo", item });
        setDemoOrders(listTrackedOrders().filter((o) => o.role === "demo"));
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "No se pudo armar el deal de demo.");
    } finally {
      setCreating(null);
    }
  }

  function handleImportKey() {
    setImportMessage(null);
    try {
      const preview = previewAccountFromKey(importKeyInput);
      const sameAsCurrent = !!localAccount && localAccount.address.toLowerCase() === preview.address.toLowerCase();
      if (!sameAsCurrent && localHasRiskyState) {
        // No reemplazamos todavía: este dispositivo tiene pedidos como
        // comprador o saldo que quedarían sin firmante. Pedimos
        // confirmación explícita antes de tocar la llave actual.
        setPendingImportKey(importKeyInput);
        return;
      }
      doImportKey(importKeyInput);
    } catch (err) {
      setImportStatus("error");
      setImportMessage(err instanceof Error ? err.message : "No se pudo importar la llave.");
    }
  }

  function doImportKey(key: string) {
    try {
      const account = importAccount(key);
      setImportStatus("done");
      setImportMessage(
        `Identidad importada: este dispositivo ahora firma como ${account.address}. ` +
          "Si había una llave anterior, quedó guardada en el historial — podés restaurarla más abajo.",
      );
      setImportKeyInput("");
    } catch (err) {
      setImportStatus("error");
      setImportMessage(err instanceof Error ? err.message : "No se pudo importar la llave.");
    } finally {
      setPendingImportKey(null);
    }
  }

  function handleRestorePrevious(address: Address) {
    const restored = restorePreviousAccount(address);
    if (restored) {
      setImportStatus("done");
      setImportMessage(`Restaurada la identidad anterior de este dispositivo: ${restored.address}.`);
    }
  }

  // Solo el relayer manda transacciones propias en este flujo: `deposit`,
  // `claim`/`cancel`, `release`/`dispute` y `refundExpired`/
  // `releaseAfterWindow` pasan TODOS por `/api/relay` (docs/escrow-interface.md
  // §6), pagados por el relayer — el vendedor de demo y la cuenta local solo
  // firman off-chain, nunca gastan su propio gas. `resolveDispute` sí la
  // manda el árbitro directamente (`msg.sender==arbiter`), pero esta página
  // no muestra el saldo del árbitro como fila, así que no hay nada más que
  // advertir acá. Antes se incluía a cualquier rol de `data.roles` con
  // saldo bajo, lo que hacía que el banner de "saldo bajo" apareciera SIEMPRE
  // (el vendedor/cuenta local de demo nunca necesitan HSK) y tapara la única
  // advertencia que importa.
  const lowBalanceRoles = data?.health?.lowBalance ? ["Relayer"] : [];

  return (
    <Layout>
      <h1 className="mt-6 font-display text-[26px] font-medium text-verde">Panel de demo</h1>
      <p className="mt-1 text-sm text-verde-mut">
        Direcciones, saldos y atajos para la demo en vivo.
      </p>

      {sellerIsArbiter ? (
        <Banner kind="error" title="VITE_DEMO_SELLER = árbitro del contrato" className="mt-4">
          El vendedor de demo configurado es la misma dirección que{" "}
          <code className="tabular-mono">escrow.arbiter()</code>. El árbitro no puede ser también
          el vendedor: corregí <code className="tabular-mono">VITE_DEMO_SELLER</code> en el env
          antes de la demo.
        </Banner>
      ) : null}

      {deviceIsDemoSeller ? (
        <Banner kind="success" title="Este dispositivo ES el vendedor de demo" className="mt-4">
          La cuenta local de este dispositivo coincide con{" "}
          <code className="tabular-mono">VITE_DEMO_SELLER</code>: puede firmar{" "}
          <code className="tabular-mono">claimDelivery</code>/<code className="tabular-mono">cancel</code>.
          Pero el contrato no permite comprador == vendedor, así que{" "}
          <strong>no puede armar deals para sí mismo</strong> — los pedidos que este
          dispositivo va a firmar como vendedor tienen que armarse desde{" "}
          <strong>otro dispositivo</strong> (el del comprador, en{" "}
          <code className="tabular-mono">/comprar</code> o su propio panel de demo). Por eso
          "Armar deal" está deshabilitado más abajo en este panel.
        </Banner>
      ) : null}

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
            warnLowGas
          />
        ) : null}
        {data?.roles.map((role) => (
          <RoleRow
            key={role.address}
            label={role.label}
            address={role.address}
            hsk={role.hsk}
            musd={role.musd}
            warnLowGas={false}
          />
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
        <h2 className="text-[16px] font-semibold text-verde">Identidad de este dispositivo</h2>
        <p className="mt-1 text-sm text-verde-mut">
          Dirección actual:{" "}
          {localAccount ? (
            <AddressMono address={localAccount.address} />
          ) : (
            <span>ninguna todavía (se crea al comprar o vender).</span>
          )}
        </p>
        <p className="mt-2 text-sm text-verde-mut">
          Pegá abajo la llave privada de <code className="tabular-mono">VITE_DEMO_SELLER</code>{" "}
          en el dispositivo que va a actuar como <strong>vendedor de demo</strong>: la necesita
          para firmar <code className="tabular-mono">claimDelivery</code>/
          <code className="tabular-mono">cancel</code>. Los pedidos para ese vendedor siempre se
          arman desde <strong>el dispositivo del comprador</strong> —en{" "}
          <code className="tabular-mono">/comprar</code> o su propio panel de demo— porque el
          contrato rechaza comprador == vendedor.
        </p>
        <p className="mt-1 text-sm font-medium text-terracota">
          Es una llave de demo en testnet, sin valor real. Nunca pegues acá una llave privada de
          verdad ni la de una cuenta con fondos reales.
        </p>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            handleImportKey();
          }}
        >
          <input
            type="password"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x… (64 caracteres hex)"
            value={importKeyInput}
            onChange={(e) => setImportKeyInput(e.target.value)}
            disabled={pendingImportKey !== null}
            className="min-h-11 flex-1 rounded-card border border-verde-mut/30 bg-blanco px-3 text-sm text-verde tabular-mono disabled:opacity-60"
          />
          <Button type="submit" disabled={pendingImportKey !== null || importKeyInput.trim().length === 0}>
            Importar llave
          </Button>
        </form>
        {importMessage ? (
          <p className={`mt-2 text-sm ${importStatus === "error" ? "text-terracota" : "text-verde-mut"}`}>
            {importMessage}
          </p>
        ) : null}

        {pendingImportKey ? (
          <Banner kind="warning" title="Esto va a reemplazar la identidad de este dispositivo" className="mt-3">
            <p>
              Este dispositivo ya tiene pedidos armados como comprador y/o saldo de mUSD
              con la cuenta actual. Importar la nueva llave la reemplaza: la cuenta actual
              queda guardada en el historial de este dispositivo (podés restaurarla después,
              junto con otras llaves anteriores), pero mientras tanto este dispositivo deja
              de poder firmar como comprador para esos pedidos.
            </p>
            <div className="mt-2 flex gap-2">
              <Button variant="danger" onClick={() => doImportKey(pendingImportKey)}>
                Sí, reemplazar
              </Button>
              <Button variant="secondary" onClick={() => setPendingImportKey(null)}>
                Cancelar
              </Button>
            </div>
          </Banner>
        ) : null}

        {previousAddresses.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            <span className="text-sm text-verde-mut">
              Llaves anteriores de este dispositivo (más reciente primero):
            </span>
            {previousAddresses.map((address) => (
              <div
                key={address}
                className="flex flex-col items-start gap-2 rounded-card bg-verde/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <AddressMono address={address} />
                <Button variant="secondary" onClick={() => handleRestorePrevious(address)}>
                  Restaurar esta identidad
                </Button>
              </div>
            ))}
          </div>
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
        {deviceIsDemoSeller ? (
          <Banner kind="warning" className="mt-3">
            Este dispositivo es el vendedor de demo: no puede armar deals para sí mismo (el
            contrato rechaza comprador == vendedor). Armá el deal desde el dispositivo
            comprador.
          </Banner>
        ) : null}
        <div className="mt-3 flex flex-col gap-2">
          <Button
            busy={creating === "normal"}
            disabled={creating !== null || deviceIsDemoSeller}
            onClick={() => armDemoDeal("normal")}
          >
            Armar deal normal (30 min de entrega)
          </Button>
          <Button
            variant="secondary"
            busy={creating === "refund"}
            disabled={creating !== null || deviceIsDemoSeller}
            onClick={() => armDemoDeal("refund")}
          >
            Armar deal de reembolso (vence en 2 min)
          </Button>
        </div>
        {createError ? (
          <Banner kind="error" className="mt-3">
            <p>{createError}</p>
            {ambiguousDemoOrder ? (
              <div className="mt-2 flex flex-col items-start gap-1">
                <p>
                  No podemos confirmar si la transacción llegó a la cadena. Guardamos esta
                  referencia — revisá el estado del pedido antes de reintentar, un reintento
                  puede fondear un segundo pedido si el primero sí se confirmó.
                </p>
                <HashMono value={ambiguousDemoOrder.ref} />
                {ambiguousDemoOrder.hash && txExplorerUrl(ambiguousDemoOrder.hash) ? (
                  <a
                    href={txExplorerUrl(ambiguousDemoOrder.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Ver la transacción en el explorer
                  </a>
                ) : null}
                <Link
                  to={`/pedido/${ambiguousDemoOrder.ref}${
                    ambiguousDemoOrder.item
                      ? `?item=${encodeURIComponent(capItem(ambiguousDemoOrder.item))}`
                      : ""
                  }`}
                  className="font-medium underline"
                >
                  Ver estado del pedido
                </Link>
              </div>
            ) : null}
          </Banner>
        ) : null}
        {demoOrders.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2">
            {demoOrders.map((order) => (
              <li key={order.ref} className="flex items-center justify-between text-sm">
                <span className="text-verde-mut">{order.item}</span>
                <Link
                  to={`/pedido/${order.ref}${
                    order.item ? `?item=${encodeURIComponent(capItem(order.item))}` : ""
                  }`}
                  className="font-medium text-verde underline"
                >
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
  warnLowGas,
}: {
  label: string;
  address: Address;
  hsk: bigint;
  musd: bigint | undefined;
  /**
   * Solo el relayer (y el árbitro, si algún día se renderiza su fila) manda
   * transacciones propias — ver el comentario grande sobre `lowBalanceRoles`
   * más arriba en este archivo. Antes esta fila marcaba "bajo" en terracota
   * para CUALQUIER rol con saldo bajo, incluido "Vendedor de demo" y "Tu
   * cuenta local" — ninguno de los dos gasta su propio gas nunca, así que era
   * una falsa alarma constante (siempre en 0 HSK) en una demo en vivo.
   */
  warnLowGas: boolean;
}) {
  const low = warnLowGas && hsk < LOW_BALANCE_WEI;
  return (
    <div className="rounded-card bg-blanco p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-verde">{label}</span>
        <AddressMono address={address} />
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className={low ? "font-semibold text-terracota" : "text-verde-mut"}>
          {formatHskAmount(hsk)} HSK{low ? " · bajo" : ""}
        </span>
        {musd !== undefined ? <AmountMono amount={musd} size="sm" /> : null}
      </div>
    </div>
  );
}
