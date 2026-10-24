







import { ed25519, ed25519ph } from "@noble/curves/ed25519.js";
import { base64UrlDecode, base64UrlEncode, resolveTokenForLookup } from "../../src/utils/enhancedToken";


export function makeTestPrivateForm(seedByte = 1): string {
  const seed = new Uint8Array(32);
  seed[0] = seedByte;
  return `gtfya.${base64UrlEncode(seed)}`;
}


export async function derivePublicForm(privateForm: string): Promise<string> {
  const publicForm = await resolveTokenForLookup(privateForm);
  if (!publicForm) throw new Error("test setup: privateForm 派生 publicForm 失败");
  return publicForm;
}


export function signFourFieldToken(privateForm: string, iat: number): string {
  const dot = privateForm.indexOf(".");
  const prefix = privateForm.slice(0, dot);
  const seed = base64UrlDecode(privateForm.slice(dot + 1));
  if (!seed) throw new Error("test setup: privateForm seed 不可解码");
  const publicKey = ed25519.getPublicKey(seed);
  const sig = ed25519ph.sign(new TextEncoder().encode(`iat=${iat}`), seed);
  return `${prefix}.${base64UrlEncode(publicKey)}.${iat}.${base64UrlEncode(sig)}`;
}
