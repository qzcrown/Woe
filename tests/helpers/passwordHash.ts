import { hashPassword } from "../../src/middleware/auth";

const memo = new Map<string, Promise<string>>();








export function hashPasswordOnce(password: string): Promise<string> {
  let hashed = memo.get(password);
  if (!hashed) {
    hashed = hashPassword(password);
    memo.set(password, hashed);
  }
  return hashed;
}
