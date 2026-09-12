# Kuska — Marca (dirección elegida: híbrido B "Luz pareja" + mono)

> Decidido por el CTO el 2026-09-11 tras un bake-off de 2 rutas. Fuente de verdad para la web (tokens de Tailwind v4 en `@theme`).

## Identidad

- **Nombre**: Kuska. **Lockup**: "Kuska · custodia contra entrega".
- **Frase**: "Kuska, en quechua: juntos, a la par. Nadie adelanta plata."
- **Signo**: sol sobre el horizonte. Un arco de horizonte + un punto **por encima** del arco, separado; nunca debajo del vértice, porque se lee como un ojo cerrado. Referencia SVG de 52×52: arco `M5 34 Q26 16 47 34`, punto en 26/15 con radio 3,6, trazo ≥ 2,8, punta redonda. Los valores finales están en `app/brand/kuska-mark.svg`. Nada más.
- **Prohibido**: chakana, textiles, íconos incas, llamas, confeti, gradientes.

## Color (UI clara; el QR siempre sobre blanco puro)

| Token | Hex | Uso | Contraste medido |
|---|---|---|---|
| `verde` | `#1C3F35` | Texto principal, botón primario | 9,62:1 sobre hueso · 11,59:1 sobre blanco |
| `verde-2` | `#2C5647` | Chip "En custodia" | hueso encima 6,89:1 |
| `verde-3` | `#12241F` | Pantalla "Fondos liberados", chip "Liberado", módulos del QR | hueso encima 13,42:1 |
| `hueso` | `#F2E9D8` | Fondo de la app | — |
| `verde-mut` | `#55665F` | Texto secundario | medir al implementar (objetivo ≥ 4,5:1 sobre hueso) |
| `terracota` | `#C1440E` | Acento escaso: contador del QR, punto de estado, candado | 4,25:1 sobre hueso → **solo ≥ 24 px en negrita o íconos**; 5,12:1 sobre blanco |
| `terracota-tint` | `#FBD9C8` | Chip "En disputa" | verde encima 8,75:1 |
| `blanco` | `#FFFFFF` | Bloque del QR | — |

## Tipografía

| Rol | Familia | Uso |
|---|---|---|
| Display | **Fraunces** 500 (Google Fonts, fallback Georgia, serif) | Wordmark, títulos de pantalla, "Entregado y pagado" |
| Texto | **Inter** 400/500/600 (fallback system-ui) | Cuerpo, botones, etiquetas |
| Datos | **JetBrains Mono** 500/600 (fallback ui-monospace) | **Montos, contador, códigos de comprobante, orderRef**, siempre con `tabular-nums` |

- **Escala**: 44 / 30 / 22 / 16 / 13 / 11 px.
- Monto del clímax: JetBrains Mono 600, 44 px, legible desde la última fila.

## Estados (corrige el choque del bake-off: cada estado tiene una forma distinta)

| Estado | Chip |
|---|---|
| Pendiente | Contorno `verde-mut` 1,4 px, texto `verde-mut`, punto `verde-mut` |
| En custodia | Relleno `verde-2`, texto hueso, **ícono de candado cerrado** |
| Entrega registrada | Relleno `verde`, texto hueso, punto `terracota` |
| Liberado | Relleno `verde-3`, texto hueso, **ícono de candado abierto** |
| Reembolsado | Fondo blanco, contorno `verde` sólido, **ícono de flecha de retorno** |
| En disputa | Relleno `terracota-tint`, texto `verde`, **ícono de alerta** |

La línea de estado muestra: Pendiente → En custodia → Entrega registrada → Liberado. Los desenlaces alternativos (Reembolsado, En disputa) reemplazan el último paso.

## Forma

- **Radios**: 8 (inputs) / 16 (tarjetas) / 28 (paneles) / pill (botones y chips).
- **Espaciado**: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64.
- Una sola sombra, reservada para el QR y la tarjeta del pedido. El resto es plano.
- **Pantalla QR del repartidor**:
  - blanco puro, QR ≥ 72 % del ancho, sin logo encima;
  - arriba "Pedido #… · monto" en mono;
  - contador en terracota a 28 px en negrita;
  - "Pedile al comprador que escanee".
- **"Fondos liberados"**:
  - fondo `verde-3`, candado abierto en terracota, monto en mono a 44 px, "Entregado y pagado" en Fraunces;
  - debajo, pequeño: código de comprobante en mono + "Ver en HashKey Chain".
- **Movimiento**: solo la transición a "Fondos liberados" (fade + el candado se abre, ≤ 400 ms); respetar `prefers-reduced-motion`.

## Vocabulario

wallet → "tu cuenta" · gas → "sin costo para ti" · hash → "código de comprobante" · escrow → "custodia" · stablecoin → "dólar digital" · firmar → "confirmar" · testnet → "ambiente de prueba".

Todo monto de prueba se rotula "(demo)". Los errores se muestran traducidos (mapa en `web/src/lib/escrow/errors.ts`), nunca un revert crudo.
