import { describe, expect, it } from "vitest";
import { verifyTypedData } from "viem/utils";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  buildCancel,
  buildDeliveryClaim,
  buildDeliveryConfirmation,
  buildDepositAuthorization,
  buildDispute,
  buildPermit,
} from "../src/lib/escrow/typedData";

// Clave generada en tiempo de test (no hardcodeada: gitleaks marca claves
// privadas conocidas, aunque sean de test networks como Anvil/Hardhat). El
// test no depende de un valor esperado fijo: deriva la dirección de la propia
// clave generada y verifica la firma contra esa dirección.
const TEST_PRIVATE_KEY = generatePrivateKey();

const ESCROW_ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const TOKEN_ADDRESS = "0x2222222222222222222222222222222222222222" as const;
const ORDER_REF = ("0x" + "aa".repeat(32)) as `0x${string}`;
const CHAIN_ID = 133;

// `verifyTypedData` de `viem/utils` (NO la de `publicClient`/`viem/actions`)
// es una función pura: solo hace recuperación ECDSA local (`recoverTypedDataAddress`),
// sin cliente ni transport. La versión de cliente, con el `mode` default
// `'auto'`, intenta PRIMERO un `eth_call` deployless de ERC-6492 y recién cae
// a la recuperación local en el catch — así que estos tests, con un cliente
// apuntando al RPC público de HSK testnet, hacían una llamada de red real en
// cada uno de los 7 casos. Como estas firmas son siempre EOA (nunca
// ERC-1271/smart account), no hace falta esa ruta: la versión pura alcanza y
// no toca la red, así que la CI no puede fallar por un RPC público lento.
describe("typedData builders", () => {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);

  it("DepositAuthorization: la firma del buyer es válida contra el dominio del escrow", async () => {
    const typedData = buildDepositAuthorization({
      chainId: CHAIN_ID,
      verifyingContract: ESCROW_ADDRESS,
      orderRef: ORDER_REF,
      seller: "0x3333333333333333333333333333333333333333",
      amount: 1_000_000n,
      deliveryDeadline: 1_893_456_000n,
      authDeadline: 1_893_456_000n,
    });
    const signature = await account.signTypedData(typedData);
    const valid = await verifyTypedData({
      address: account.address,
      ...typedData,
      signature,
    });
    expect(valid).toBe(true);
  });

  it("DeliveryClaim: la firma del seller es válida", async () => {
    const typedData = buildDeliveryClaim({
      chainId: CHAIN_ID,
      verifyingContract: ESCROW_ADDRESS,
      orderRef: ORDER_REF,
      sigDeadline: 1_893_456_000n,
    });
    const signature = await account.signTypedData(typedData);
    const valid = await verifyTypedData({
      address: account.address,
      ...typedData,
      signature,
    });
    expect(valid).toBe(true);
  });

  it("Cancel: la firma del seller es válida", async () => {
    const typedData = buildCancel({
      chainId: CHAIN_ID,
      verifyingContract: ESCROW_ADDRESS,
      orderRef: ORDER_REF,
      sigDeadline: 1_893_456_000n,
    });
    const signature = await account.signTypedData(typedData);
    const valid = await verifyTypedData({
      address: account.address,
      ...typedData,
      signature,
    });
    expect(valid).toBe(true);
  });

  it("DeliveryConfirmation: la firma del buyer es válida", async () => {
    const typedData = buildDeliveryConfirmation({
      chainId: CHAIN_ID,
      verifyingContract: ESCROW_ADDRESS,
      orderRef: ORDER_REF,
      sigDeadline: 1_893_456_000n,
    });
    const signature = await account.signTypedData(typedData);
    const valid = await verifyTypedData({
      address: account.address,
      ...typedData,
      signature,
    });
    expect(valid).toBe(true);
  });

  it("Dispute: la firma del buyer es válida", async () => {
    const typedData = buildDispute({
      chainId: CHAIN_ID,
      verifyingContract: ESCROW_ADDRESS,
      orderRef: ORDER_REF,
      sigDeadline: 1_893_456_000n,
    });
    const signature = await account.signTypedData(typedData);
    const valid = await verifyTypedData({
      address: account.address,
      ...typedData,
      signature,
    });
    expect(valid).toBe(true);
  });

  it("Permit (EIP-2612): la firma del owner es válida contra el dominio del token", async () => {
    const typedData = buildPermit({
      domain: {
        name: "Kuska Demo USD",
        version: "1",
        chainId: CHAIN_ID,
        verifyingContract: TOKEN_ADDRESS,
      },
      owner: account.address,
      spender: ESCROW_ADDRESS,
      value: 1_000_000n,
      nonce: 0n,
      deadline: 1_893_456_000n,
    });
    const signature = await account.signTypedData(typedData);
    const valid = await verifyTypedData({
      address: account.address,
      ...typedData,
      signature,
    });
    expect(valid).toBe(true);
  });

  it("una firma de otra cuenta no es aceptada", async () => {
    const other = privateKeyToAccount(generatePrivateKey());
    const typedData = buildCancel({
      chainId: CHAIN_ID,
      verifyingContract: ESCROW_ADDRESS,
      orderRef: ORDER_REF,
      sigDeadline: 1_893_456_000n,
    });
    const signature = await other.signTypedData(typedData);
    const valid = await verifyTypedData({
      address: account.address,
      ...typedData,
      signature,
    });
    expect(valid).toBe(false);
  });
});
