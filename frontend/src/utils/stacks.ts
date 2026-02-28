import { AppConfig, UserSession, showConnect, openContractCall } from "@stacks/connect";
import { StacksTestnet } from "@stacks/network";
import { callReadOnlyFunction, bufferCV, uintCV, principalCV, cvToJSON } from "@stacks/transactions";
import { CONTRACT_ADDRESS, CONTRACT_NAME } from "./contract";

const appConfig = new AppConfig(["store_write", "publish_data"]);
export const userSession = new UserSession({ appConfig });
const network = new StacksTestnet();

export interface WalletState { address: string; }

export function getWalletState(): WalletState | null {
  if (!userSession.isUserSignedIn()) return null;
  const data = userSession.loadUserData();
  return { address: data.profile.stxAddress.testnet };
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

type Arg = { type: "uint"; value: string } | { type: "buff"; value: string } | { type: "principal"; value: string };

function buildCV(arg: Arg) {
  if (arg.type === "uint") return uintCV(BigInt(arg.value));
  if (arg.type === "buff") return bufferCV(Buffer.from(arg.value, "hex"));
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
  const result = await callReadOnlyFunction({
    network,
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName,
    functionArgs: args.map(buildCV),
    senderAddress: CONTRACT_ADDRESS,
  });
  return cvToJSON(result).value;
}
