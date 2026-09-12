# Kuska — Interfaz congelada del escrow (v1)

> Contrato entre carriles: contratos (Foundry), web y relayer. **Cambiar algo de acá requiere avisar a todos los carriles.**
> Red de demo: HSK Chain Testnet (chainId 133). Mainnet (177) opcional con USDC.e.

## 1. Redes

| | Testnet | Mainnet |
|---|---|---|
| chainId | 133 | 177 |
| RPC | `https://testnet.hsk.xyz` | `https://mainnet.hsk.xyz` |
| Explorer | `https://testnet-explorer.hsk.xyz` | `https://hsk.blockscout.com` |
| viem | `hashkeyTestnet` (`viem/chains`) | `hashkey` |
| Token | `MockUSD` (nuestro) | USDC.e `0x054ed45810DbBAb8B27668922D110669c9D88D0a` (FiatTokenV2_2, permit, 6 dec) |

Solidity `^0.8.28`, OpenZeppelin Contracts v5, EVM por defecto (Cancun verificado en ambas redes).

## 2. `MockUSD`

- `ERC20("Kuska Demo USD", "mUSD")` + `ERC20Permit("Kuska Demo USD")`.
- `decimals() = 6`.
- `function faucet(address to) external`: mintea `100 * 10**6` a `to`. Cooldown de 1 h por `to`:
  - `mapping(address => uint256) public lastFaucetAt`;
  - `error FaucetCooldown(uint256 availableAt)`;
  - la primera llamada siempre pasa.
- **Dominio del permit en la web**: leer `eip712Domain()` (EIP-5267, lo trae OZ). Si revierte (USDC.e), usar `name()` + `version()`.

## 3. `KuskaEscrow`

```solidity
enum State { None, Funded, DeliveryClaimed, Disputed, Released, Refunded } // 0..5

struct Deal {
    address buyer;
    uint96  amount;
    address seller;
    uint64  deliveryDeadline;
    uint64  claimedAt;
    State   state;
}

constructor(address token, address arbiter, uint64 disputeWindow); // los tres immutable, token != 0, arbiter != 0, disputeWindow > 0
// EIP712 domain: name "KuskaEscrow", version "1"
```

### Vistas públicas
- `token() → address` · `arbiter() → address` · `disputeWindow() → uint64`
- `getDeal(bytes32 orderRef) → Deal` (la web lee con esto)
- `eip712Domain()` (OZ EIP712)
- Constantes públicas `DEPOSIT_AUTHORIZATION_TYPEHASH`, `DELIVERY_CLAIM_TYPEHASH`, `CANCEL_TYPEHASH`, `DELIVERY_CONFIRMATION_TYPEHASH`, `DISPUTE_TYPEHASH`

### Tipos EIP-712 (strings exactos)
```
DepositAuthorization(bytes32 orderRef,address seller,uint256 amount,uint64 deliveryDeadline,uint256 authDeadline)   firma: buyer
DeliveryClaim(bytes32 orderRef,uint256 sigDeadline)                                                                  firma: seller
Cancel(bytes32 orderRef,uint256 sigDeadline)                                                                         firma: seller
DeliveryConfirmation(bytes32 orderRef,uint256 sigDeadline)                                                           firma: buyer
Dispute(bytes32 orderRef,uint256 sigDeadline)                                                                        firma: buyer
```
Todas se verifican con `SignatureChecker.isValidSignatureNow(signer, _hashTypedDataV4(structHash), sig)` (EOA + ERC-1271).

### Funciones (orden exacto de parámetros)

| Función | Requiere | Efecto |
|---|---|---|
| `depositWithPermit(bytes32 orderRef, address buyer, address seller, uint256 amount, uint64 deliveryDeadline, uint256 authDeadline, bytes authSig, uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s)` | `state==None`; `0 < amount ≤ type(uint96).max`; `buyer≠0`, `seller≠0`, `seller≠buyer`; `deliveryDeadline > now`; `now ≤ authDeadline`; authSig válida del buyer | `try token.permit(buyer, this, amount, permitDeadline, v, r, s) {} catch {}` → `safeTransferFrom(buyer, this, amount)` → `Funded` |
| `claimDelivery(bytes32 orderRef, uint256 sigDeadline, bytes sellerSig)` | `state==Funded`; `now ≤ deliveryDeadline`; `now ≤ sigDeadline`; firma del seller | `claimedAt = now`, `DeliveryClaimed` |
| `release(bytes32 orderRef, uint256 sigDeadline, bytes buyerSig)` | `state ∈ {Funded, DeliveryClaimed}`; `now ≤ sigDeadline`; firma del buyer | `Released`, transfiere al seller |
| `dispute(bytes32 orderRef, uint256 sigDeadline, bytes buyerSig)` | `state==DeliveryClaimed`; `now < claimedAt + disputeWindow`; `now ≤ sigDeadline`; firma del buyer | `Disputed` |
| `releaseAfterWindow(bytes32 orderRef)` | `state==DeliveryClaimed`; `now ≥ claimedAt + disputeWindow` | `Released`, transfiere al seller |
| `refundExpired(bytes32 orderRef)` | `state==Funded`; `now > deliveryDeadline` | `Refunded`, transfiere al buyer |
| `cancel(bytes32 orderRef, uint256 sigDeadline, bytes sellerSig)` | `state==Funded`; `now ≤ sigDeadline`; firma del seller | `Refunded`, transfiere al buyer |
| `resolveDispute(bytes32 orderRef, bool toSeller)` | `msg.sender==arbiter`; `state==Disputed` | `Released` (seller) o `Refunded` (buyer) |

**Reglas**:
- el estado se escribe **antes** de transferir (CEI);
- `orderRef` nunca se reutiliza (los estados terminales no vuelven a `None`);
- `claimedAt` no se reinicia;
- `msg.sender` solo importa en `resolveDispute`;
- sin `Ownable`, sin setters, sin pausa;
- usar `SafeERC20` y `ReentrancyGuard` (`nonReentrant` en las funciones que transfieren).

### Errores
```solidity
error InvalidState(State current);
error InvalidSignature();
error SignatureExpired();
error InvalidAmount();
error InvalidAddress();
error DeliveryDeadlinePassed();     // claim tardío o deliveryDeadline <= now al depositar
error DeliveryDeadlineNotReached(); // refundExpired temprano
error DisputeWindowOpen();          // releaseAfterWindow temprano
error DisputeWindowClosed();        // dispute tardía
error NotArbiter();
```

### Eventos
```solidity
event Deposited(bytes32 indexed orderRef, address indexed buyer, address indexed seller, uint256 amount, uint64 deliveryDeadline);
event DeliveryClaimed(bytes32 indexed orderRef, address indexed seller, uint64 claimedAt);
event Released(bytes32 indexed orderRef, address indexed seller, uint256 amount, uint8 reason); // 0 buyerConfirmed · 1 windowElapsed · 2 arbiter
event Refunded(bytes32 indexed orderRef, address indexed buyer, uint256 amount, uint8 reason);  // 0 expired · 1 sellerCancel · 2 arbiter
event Disputed(bytes32 indexed orderRef, address indexed buyer);
event DisputeResolved(bytes32 indexed orderRef, bool toSeller);
```

## 4. Convenciones compartidas

- **`orderRef`** = `keccak256(toBytes(crypto.randomUUID()))`, generado por el comprador. El ítem del catálogo viaja fuera de la cadena (query `?item=`).
- **Deadlines por defecto**:
  - `authDeadline`, `permitDeadline` y `sigDeadline` = `now + 600` s;
  - `deliveryDeadline` = `now + 1800` s en el flujo en vivo y `now + 120` s en los deals de reembolso pre-armados.
- **`disputeWindow` del deploy de demo**: `90` s.
- **Etiquetas de UI**:

| Estado | Etiqueta |
|---|---|
| None | "—" |
| Funded | "En custodia" |
| DeliveryClaimed | "Entrega registrada" |
| Disputed | "En disputa" |
| Released | "Liberado" |
| Refunded | "Reembolsado" |

- **Tipos**: `uint256` y `uint64` viajan en JSON como **string decimal**; direcciones, bytes32 y firmas como hex `0x…`.

## 5. `deployments/<chainId>.json` (lo escribe `Deploy.s.sol`; lo importan la web y el relayer)
```json
{ "chainId": 133, "escrow": "0x…", "token": "0x…", "arbiter": "0x…", "disputeWindow": 90, "deployBlock": 0, "explorer": "https://testnet-explorer.hsk.xyz" }
```

## 6. API del relayer (Vercel Functions, `web/api/`)

### `POST /api/relay`
```json
{ "action": "deposit" | "claim" | "release" | "dispute" | "cancel" | "refundExpired" | "releaseAfterWindow", "params": { … } }
```

**`params` por acción:**

| Acción | `params` |
|---|---|
| `deposit` | `{ orderRef, buyer, seller, amount, deliveryDeadline, authDeadline, authSig, permitDeadline, permitSig }` (el relayer separa `permitSig` en v, r, s con `parseSignature`) |
| `claim`, `cancel` | `{ orderRef, sigDeadline, sellerSig }` |
| `release`, `dispute` | `{ orderRef, sigDeadline, buyerSig }` |
| `refundExpired`, `releaseAfterWindow` | `{ orderRef }` |

**Pipeline obligatorio:**
1. validar el esquema;
1.5. verificar (memoizado por proceso) que la dirección del escrow tenga bytecode desplegado — si no, `503 MISCONFIGURED` sin mandar ninguna tx;
2. verificar off-chain la firma EIP-712 contra el firmante esperado. Para claim, cancel, release y dispute se lee `getDeal` y se usa `deal.seller` o `deal.buyer`;
3. `simulateContract`;
4. `writeContract`;
5. `waitForTransactionReceipt` (timeout 20 s); si el receipt no viene con `status: "success"`, `409 TX_REVERTED` con el hash;
6. ante un error de nonce (incluye "nonce too low" y "replacement underpriced"), reintentar hasta 2 veces con el nonce `pending` (hasta ~250ms de espera entre intentos).

**Respuestas:**

| Código | Cuerpo |
|---|---|
| `200` | `{ hash, blockNumber, status: "success" }` |
| `400` | `{ code: "INVALID_REQUEST" \| "INVALID_SIGNATURE" }` |
| `409` | `{ code: "SIMULATION_REVERTED", reason }` (`reason` = nombre del custom error) o `{ code: "TX_REVERTED", hash }` |
| `502` | `{ code: "RPC_ERROR" }` |
| `503` | `{ code: "MISCONFIGURED" }` (la dirección del escrow/token configurada no tiene bytecode) |
| `504` | `{ code: "RECEIPT_TIMEOUT", hash }` |

### `POST /api/faucet`
- Body `{ to }`: llama `MockUSD.faucet(to)` (simular primero). Antes de simular, verifica
  (memoizado por proceso) que la dirección del token tenga bytecode desplegado.
- Respuestas:
  - `200 { hash }`;
  - `409 { code: "FAUCET_COOLDOWN", availableAt }`;
  - `503 { code: "MISCONFIGURED" }` (la dirección del token no tiene bytecode);
  - en mainnet → `404`.

### `GET /api/health`
- Devuelve `{ chainId, relayer, relayerBalanceWei, escrow, token, lowBalance }`.
- `lowBalance` = saldo < 0,02 HSK.

### Variables de entorno
- **Servidor**: `RELAYER_PRIVATE_KEY` (sensible, nunca `VITE_`), `CHAIN_ID`, `RPC_URL`.
- **Cliente**:
  - `VITE_CHAIN_ID`;
  - `VITE_DEMO_SELLER` (dirección del vendedor de demo);
  - las direcciones salen de `deployments/<chainId>.json`.

## 7. Llaves (nunca en el repo)

- Archivo: `~/.kuska/keys.env` (chmod 600), con `DEPLOYER_*`, `RELAYER_*` y `ARBITER_*`.
- Solo las **direcciones** pueden aparecer en docs y logs.
