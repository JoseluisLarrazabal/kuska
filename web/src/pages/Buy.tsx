import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { isAddress, type Address, type Hex } from "viem";
import { Layout } from "../lib/ui/components/Layout";
import { Field } from "../lib/ui/components/Field";
import { Button } from "../lib/ui/components/Button";
import { Banner } from "../lib/ui/components/Banner";
import { AddressMono } from "../lib/ui/components/AddressMono";
import { HashMono } from "../lib/ui/components/HashMono";
import { getOrCreateAccount } from "../lib/burner";
import { isBurnerPersistent } from "../lib/ui/burnerStatus";
import { getDeploymentConfig } from "../config/deployment";
import { parseAmountInput } from "../lib/ui/format";
import { createOrder } from "../lib/ui/depositFlow";
import { trackOrder } from "../lib/ui/orderRegistry";
import { capItem } from "../lib/ui/orderLink";
import { postFaucet, relayErrorMaybeSentTx } from "../lib/ui/relayer";
import { txExplorerUrl } from "../lib/ui/explorer";
import { DropletIcon } from "../lib/ui/components/Icon";

/** `deliveryDeadline` del flujo en vivo (docs/escrow-interface.md §4: now + 1800s). */
const LIVE_DELIVERY_SECONDS = 1800;

type Status = "idle" | "signing" | "relaying" | "success" | "error";

/** Query string `?item=...` (recortado con `capItem`) para propagar la referencia del pedido a `/pedido/:ref`, o `""` si no hay item. */
function itemQuery(item: string): string {
  const capped = capItem(item);
  return capped ? `?item=${encodeURIComponent(capped)}` : "";
}

export default function Buy() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const deployment = getDeploymentConfig();

  const [seller, setSeller] = useState<string>(deployment.demoSeller);
  const [amountInput, setAmountInput] = useState("10");
  const [item, setItem] = useState(params.get("item") ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  // Referencia del pedido cuando el relayer respondió con una falla que puede
  // haber mandado (o dejado pendiente de confirmar) la transacción igual
  // (`relayErrorMaybeSentTx`): sin esto, un timeout/`TX_REVERTED` perdía el
  // `orderRef` para siempre y un reintento fondeaba un segundo pedido encima
  // de fondos que podían haber quedado en custodia sin que nadie los viera.
  // `item` queda capturado acá con el valor REALMENTE enviado: el campo del
  // formulario sigue editable después del submit, así que el link de
  // recuperación no puede leer el `item` en vivo (si el usuario lo edita
  // antes de reintentar, `Order.tsx` pisaría el label correcto del pedido A
  // con el texto nuevo de B).
  const [ambiguousOrder, setAmbiguousOrder] = useState<{ ref: Hex; hash?: string; item: string } | null>(
    null,
  );

  const [faucetStatus, setFaucetStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [faucetMessage, setFaucetMessage] = useState<string | null>(null);

  // "Comprar" es un flujo donde crear la cuenta burner es esperado y explícito
  // (ver el docstring de `getOrCreateAccount` en lib/burner.ts). Esto tiene
  // que ejecutarse ANTES de `isBurnerPersistent()`: en la primera visita
  // (localStorage funcionando, sin llave todavía) `isPersistent()` mira si
  // YA hay algo guardado, así que llamarla antes de crear la cuenta siempre
  // daba `false` — un aviso de "esta cuenta no se va a guardar" falso hasta
  // recargar, aunque el guardado hubiera funcionado perfectamente.
  const buyerPreview = useMemo(() => getOrCreateAccount().address, []);
  const persistent = useMemo(() => isBurnerPersistent(), [buyerPreview]);
  const sellerIsLocalAccount = isAddress(seller) && seller.toLowerCase() === buyerPreview.toLowerCase();
  const sellerError = seller.length > 0 && !isAddress(seller)
    ? "Dirección inválida (0x + 40 hex)."
    : sellerIsLocalAccount
      ? "El vendedor no puede ser esta misma cuenta: el contrato no permite comprador == vendedor. Este mismo dispositivo es el vendedor — el pedido tiene que armarse desde el dispositivo del comprador."
      : undefined;
  const parsedAmount = parseAmountInput(amountInput);
  const amountError =
    amountInput.length > 0 && parsedAmount === undefined
      ? "Ingresá un monto válido (hasta 6 decimales, mayor a 0)."
      : undefined;

  const canSubmit =
    isAddress(seller) &&
    !sellerError &&
    parsedAmount !== undefined &&
    (status === "idle" || status === "error");

  async function requestFaucet() {
    setFaucetStatus("loading");
    setFaucetMessage(null);
    const buyer = getOrCreateAccount();
    const outcome = await postFaucet(buyer.address);
    if (outcome.ok) {
      setFaucetStatus("done");
      setFaucetMessage("Listo: le acreditamos 100 mUSD (demo) a tu cuenta.");
    } else {
      setFaucetStatus("error");
      setFaucetMessage(outcome.message);
    }
  }

  async function submit() {
    if (!isAddress(seller) || sellerError) return;
    const amountUnits = parseAmountInput(amountInput);
    if (amountUnits === undefined) return;
    setStatus("signing");
    setErrorMessage(null);
    setTxHash(null);
    setAmbiguousOrder(null);

    try {
      const buyer = getOrCreateAccount();
      setStatus("relaying");
      const { orderRef, outcome } = await createOrder({
        buyer,
        seller: seller as Address,
        amount: amountUnits,
        deliverySeconds: LIVE_DELIVERY_SECONDS,
      });

      if (!outcome.ok) {
        setStatus("error");
        setErrorMessage(outcome.error.message);
        // La falla puede haber llegado DESPUÉS de mandar la tx (p. ej. un
        // 504 RECEIPT_TIMEOUT): sin trackear el pedido acá, el `orderRef` se
        // perdía para siempre y un reintento fondeaba un segundo pedido
        // encima de fondos que podían haber quedado en custodia.
        if (relayErrorMaybeSentTx(outcome.error)) {
          trackOrder(orderRef, { item: item || undefined, role: "buyer" });
          setAmbiguousOrder({ ref: orderRef, hash: outcome.error.hash, item });
        }
        return;
      }

      trackOrder(orderRef, { item: item || undefined, role: "buyer" });
      setTxHash(outcome.data.hash);
      setStatus("success");

      setTimeout(() => navigate(`/pedido/${orderRef}${itemQuery(item)}`), 1200);
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err instanceof Error
          ? `No se pudo preparar la firma: ${err.message}`
          : "No se pudo preparar la firma. Intentá de nuevo.",
      );
    }
  }

  return (
    <Layout>
      <h1 className="mt-6 font-display text-[26px] font-medium text-verde">Armar un pedido</h1>
      <p className="mt-1 text-sm text-verde-mut">
        Fondeás en dólares digitales de demo. No pagás gas: nosotros mandamos la
        transacción por vos.
      </p>

      {!persistent ? (
        <Banner kind="warning" title="Esta cuenta no se va a guardar" className="mt-4">
          Tu navegador no puede guardar tu cuenta local (modo privado, cuota llena, o
          almacenamiento bloqueado). Si cerrás esta pestaña vas a perder acceso para
          confirmar la recepción más adelante. Probá en una ventana normal antes de
          fondear.
        </Banner>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Mismo guard que el `disabled` del botón: sin esto, Enter podía
          // mandar un segundo submit mientras el primero seguía en curso
          // (firmando/enviando).
          if (canSubmit) submit();
        }}
      >
        <div className="mt-6 flex flex-col gap-4">
          <Field
            label="Vendedor"
            monospace
            value={seller}
            onChange={(e) => setSeller(e.target.value.trim())}
            error={sellerError}
            hint="Dirección 0x del vendedor (por defecto, el vendedor de demo)."
            autoComplete="off"
            spellCheck={false}
          />
          <Field
            label="Monto (demo)"
            inputMode="decimal"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            error={amountError}
            hint="mUSD de prueba — no es dinero real."
          />
          <Field
            label="Referencia del pedido (opcional)"
            value={item}
            onChange={(e) => setItem(e.target.value)}
            hint="Para vos y el vendedor. No se guarda en la cadena."
            placeholder="p. ej. 40 cajas de tornillos M8"
          />
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={requestFaucet}
            disabled={faucetStatus === "loading"}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-verde-mut hover:text-verde disabled:opacity-60"
          >
            <DropletIcon size={16} />
            {faucetStatus === "loading" ? "Pidiendo fondos…" : "Pedir mUSD de prueba para esta cuenta"}
          </button>
          {faucetMessage ? (
            <p className={`mt-1 text-xs ${faucetStatus === "error" ? "text-terracota" : "text-verde-mut"}`}>
              {faucetMessage}
            </p>
          ) : null}
        </div>

        {status === "error" && errorMessage ? (
          <Banner kind="error" title="No se pudo fondear el pedido" className="mt-4">
            <p>{errorMessage}</p>
            {ambiguousOrder ? (
              <div className="mt-2 flex flex-col items-start gap-1">
                <p>
                  No podemos confirmar si la transacción llegó a la cadena. Guardá esta
                  referencia y revisá el estado del pedido antes de reintentar — un
                  reintento puede fondear un segundo pedido si el primero sí se confirmó.
                </p>
                <HashMono value={ambiguousOrder.ref} />
                {ambiguousOrder.hash && txExplorerUrl(ambiguousOrder.hash) ? (
                  <a
                    href={txExplorerUrl(ambiguousOrder.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Ver la transacción en el explorer
                  </a>
                ) : null}
                <Link
                  to={`/pedido/${ambiguousOrder.ref}${itemQuery(ambiguousOrder.item)}`}
                  className="font-medium underline"
                >
                  Ver estado del pedido
                </Link>
              </div>
            ) : null}
          </Banner>
        ) : null}

        {status === "success" && txHash ? (
          <Banner kind="success" title="Pedido fondeado" className="mt-4">
            <p>Los fondos quedaron en custodia.</p>
            <div className="mt-1">
              <HashMono value={txHash} />
            </div>
            {txExplorerUrl(txHash) ? (
              <a
                href={txExplorerUrl(txHash)}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block underline"
              >
                Ver en el explorer de HashKey Chain
              </a>
            ) : null}
          </Banner>
        ) : null}

        <Button type="submit" className="mt-6 w-full" disabled={!canSubmit} busy={status === "signing" || status === "relaying"}>
          {status === "signing"
            ? "Firmando…"
            : status === "relaying"
              ? "Enviando…"
              : "Confirmar y fondear"}
        </Button>
      </form>

      <p className="mt-3 text-xs text-verde-mut">
        Tu cuenta local: <AddressMono address={buyerPreview} />
      </p>
    </Layout>
  );
}
