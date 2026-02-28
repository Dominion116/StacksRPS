export function randomBytes(length: number): string {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(hexInput: string): Promise<string> {
  const bytes = hexToBytes(hexInput);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return arr;
}

export async function makeCommit(moveNum: number): Promise<{ commit: string; salt: string }> {
  const salt = randomBytes(32);
  const moveHex = moveNum.toString(16).padStart(2, "0");
  const commit = await sha256Hex(moveHex + salt);
  return { commit, salt };
}
