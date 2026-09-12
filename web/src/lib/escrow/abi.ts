import { parseAbi } from "viem";

/**
 * ABI humano de `KuskaEscrow`, firmas EXACTAS según docs/escrow-interface.md
 * (secciones 3 y 4). El struct `Deal` usa la sintaxis de struct de viem/abitype
 * para que `getDeal` devuelva un objeto con nombres de campo.
 */
export const kuskaEscrowAbi = parseAbi([
  // --- struct ---
  "struct Deal { address buyer; uint96 amount; address seller; uint64 deliveryDeadline; uint64 claimedAt; uint8 state; }",

  // --- vistas públicas ---
  "function token() view returns (address)",
  "function arbiter() view returns (address)",
  "function disputeWindow() view returns (uint64)",
  "function getDeal(bytes32 orderRef) view returns (Deal)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  "function DEPOSIT_AUTHORIZATION_TYPEHASH() view returns (bytes32)",
  "function DELIVERY_CLAIM_TYPEHASH() view returns (bytes32)",
  "function CANCEL_TYPEHASH() view returns (bytes32)",
  "function DELIVERY_CONFIRMATION_TYPEHASH() view returns (bytes32)",
  "function DISPUTE_TYPEHASH() view returns (bytes32)",

  // --- funciones de estado (orden exacto de parámetros, sección 3) ---
  "function depositWithPermit(bytes32 orderRef, address buyer, address seller, uint256 amount, uint64 deliveryDeadline, uint256 authDeadline, bytes authSig, uint256 permitDeadline, uint8 v, bytes32 r, bytes32 s)",
  "function claimDelivery(bytes32 orderRef, uint256 sigDeadline, bytes sellerSig)",
  "function release(bytes32 orderRef, uint256 sigDeadline, bytes buyerSig)",
  "function dispute(bytes32 orderRef, uint256 sigDeadline, bytes buyerSig)",
  "function releaseAfterWindow(bytes32 orderRef)",
  "function refundExpired(bytes32 orderRef)",
  "function cancel(bytes32 orderRef, uint256 sigDeadline, bytes sellerSig)",
  "function resolveDispute(bytes32 orderRef, bool toSeller)",

  // --- errores ---
  "error InvalidState(uint8 current)",
  "error InvalidSignature()",
  "error SignatureExpired()",
  "error InvalidAmount()",
  "error InvalidAddress()",
  "error DeliveryDeadlinePassed()",
  "error DeliveryDeadlineNotReached()",
  "error DisputeWindowOpen()",
  "error DisputeWindowClosed()",
  "error NotArbiter()",

  // --- eventos ---
  "event Deposited(bytes32 indexed orderRef, address indexed buyer, address indexed seller, uint256 amount, uint64 deliveryDeadline)",
  "event DeliveryClaimed(bytes32 indexed orderRef, address indexed seller, uint64 claimedAt)",
  "event Released(bytes32 indexed orderRef, address indexed seller, uint256 amount, uint8 reason)",
  "event Refunded(bytes32 indexed orderRef, address indexed buyer, uint256 amount, uint8 reason)",
  "event Disputed(bytes32 indexed orderRef, address indexed buyer)",
  "event DisputeResolved(bytes32 indexed orderRef, bool toSeller)",
]);

/**
 * ABI humano de `MockUSD`: ERC20 + ERC20Permit (OZ v5) + faucet de demo.
 * `version()` se declara como vista opcional: no todos los tokens (p. ej.
 * MockUSD) la exponen; `typedData.ts` la llama con fallback a "1" si falla.
 */
export const mockUsdAbi = parseAbi([
  // --- ERC20 ---
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",

  // --- ERC20Permit (EIP-2612) ---
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function nonces(address owner) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",

  // --- EIP-5267 (dominio EIP-712 vía OZ EIP712) ---
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  "function version() view returns (string)",

  // --- faucet de demo ---
  "function faucet(address to)",
  "function lastFaucetAt(address account) view returns (uint256)",
  "error FaucetCooldown(uint256 availableAt)",
]);
