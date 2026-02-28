import { AppConfig, UserSession, showConnect, openContractCall } from "@stacks/connect";
import { StacksMainnet } from "@stacks/network";
import { callReadOnlyFunction, bufferCV, uintCV, principalCV, cvToJSON } from "@stacks/transactions";
import { CONTRACT_ADDRESS, CONTRACT_NAME } from "./contract";

const appConfig = new AppConfig(["store_write", "publish_data"]);
export const userSession = new UserSession({ appConfig });
const network = new StacksMainnet();

export interface WalletState { address: string; }

export function getWalletState(): WalletState | null {
  if (!userSession.isUserSignedIn()) return null;
  const data = userSession.loadUserData();
  return { address: data.profile.stxAddress.mainnet };
}

export function connectWallet(): Promise<WalletState> {
  return new Promise((resolve, reject) => {
    showConnect({
      appDetails: { name: "RPS Chain", icon: "/favicon.svg" },
      redirectTo: "/",
      userSession,
      onFinish: () => {
        const state = getWalletState();
        if (state) resolve(state);
        else reject(new Error("Could not load wallet state"));
      },
      onCancel: () => reject(new Error("Cancelled")),
    });
  });
}

export function disconnectWallet() { userSession.signUserOut(); }

function hexToUint8Array(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return arr;
}

function uint8ArrayToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

type Arg = { type: "uint"; value: string } | { type: "buff"; value: string } | { type: "principal"; value: string };

function buildCV(arg: Arg) {
  if (arg.type === "uint") return uintCV(BigInt(arg.value));
  if (arg.type === "buff") return bufferCV(hexToUint8Array(arg.value));
  return principalCV(arg.value);
}

export function callContract(functionName: string, args: Arg[]): Promise<string> {
  return new Promise((resolve, reject) => {
    openContractCall({
      network,
      contractAddress: CONTRACT_ADDRESS,
      contractName: CONTRACT_NAME,
      functionName,
      functionArgs: args.map(buildCV),
      onFinish: (data) => resolve(data.txId),
      onCancel: () => reject(new Error("Transaction cancelled")),
    });
  });
}

export async function readContract(functionName: string, args: Arg[]): Promise<any> {
  const { serializeCV, deserializeCV } = await import("@stacks/transactions");

  const serializedArgs = args.map(a => {
    const cv = buildCV(a);
    const bytes = serializeCV(cv); // returns Uint8Array in browser (no Buffer needed)
    return "0x" + uint8ArrayToHex(bytes);
  });

  const response = await fetch(
    `https://api.hiro.so/v2/contracts/call-read/${CONTRACT_ADDRESS}/${CONTRACT_NAME}/${functionName}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: CONTRACT_ADDRESS, arguments: serializedArgs }),
    }
  );

  const data = await response.json();
  if (!data.okay) throw new Error(`Contract read failed: ${JSON.stringify(data)}`);

  const resultBytes = hexToUint8Array(data.result.slice(2));
  const cv = deserializeCV(resultBytes);
  return cvToJSON(cv).value;
}