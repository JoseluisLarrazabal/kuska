import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "../lib/ui/components/Layout";
import { Field } from "../lib/ui/components/Field";
import { Button } from "../lib/ui/components/Button";
import { Banner } from "../lib/ui/components/Banner";
import { QrScannerView } from "../lib/ui/components/QrScannerView";
import { KeyboardIcon, ScanLineIcon } from "../lib/ui/components/Icon";
import { parseItemFromText, parseOrderRefFromText } from "../lib/ui/orderLink";

export default function Deliver() {
  const navigate = useNavigate();
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function goToOrder(text: string) {
    const ref = parseOrderRefFromText(text);
    if (!ref) {
      setError("Ese código no es válido. Revisá que sea el QR (o el código) que te mostró el vendedor.");
      return;
    }
    // `item` viene del mismo link/QR que el `ref` (ver `buildConfirmUrl`) —
    // sin propagarlo acá, el label humano del pedido se perdía apenas se
    // confirmaba la entrega, tanto escaneando como pegando el código a mano.
    const item = parseItemFromText(text);
    const query = item ? `&item=${encodeURIComponent(item)}` : "";
    navigate(`/pedido/${ref}?accion=liberar${query}`);
  }

  return (
    <Layout>
      <h1 className="mt-6 font-display text-[26px] font-medium text-verde">Confirmar entrega</h1>
      <p className="mt-1 text-sm text-verde-mut">
        Escaneá el código QR que te muestra el vendedor para confirmar que recibiste el
        pedido y liberar el pago.
      </p>

      {error ? (
        <Banner kind="error" className="mt-4">
          {error}
        </Banner>
      ) : null}

      {!manualMode ? (
        <>
          <QrScannerView onDecode={goToOrder} className="mt-6 h-72" />
          <button
            type="button"
            onClick={() => setManualMode(true)}
            className="mt-4 flex min-h-11 items-center gap-1.5 text-sm font-medium text-verde-mut hover:text-verde"
          >
            <KeyboardIcon size={16} />
            Ingresar el código a mano
          </button>
        </>
      ) : (
        <form
          className="mt-6 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            goToOrder(manualCode);
          }}
        >
          <Field
            label="Código del pedido"
            monospace
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="0x… (o pegá el link completo)"
            hint="Te lo pasa el vendedor, o pegá el link que te compartió."
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" disabled={manualCode.trim().length === 0}>
            Continuar
          </Button>
          <button
            type="button"
            onClick={() => setManualMode(false)}
            className="flex min-h-11 items-center gap-1.5 self-center text-sm font-medium text-verde-mut hover:text-verde"
          >
            <ScanLineIcon size={16} />
            Volver a la cámara
          </button>
        </form>
      )}
    </Layout>
  );
}
