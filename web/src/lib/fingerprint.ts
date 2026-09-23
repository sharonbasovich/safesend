// Mirrors SafeSend.fingerprint: top 16 bits ++ low 16 bits of the address
// (the first 4 and last 4 hex characters — what humans compare and what
// address-poisoning attacks fake).
export function fingerprint(addr: string): number {
  const hex = addr.toLowerCase().replace(/^0x/, "");
  if (hex.length !== 40 || !/^[0-9a-f]+$/.test(hex)) throw new Error("not an address");
  const top = parseInt(hex.slice(0, 4), 16);
  const low = parseInt(hex.slice(-4), 16);
  return ((top << 16) | low) >>> 0;
}

export function isLookalikeOf(payee: string, candidate: string): boolean {
  return fingerprint(payee) === fingerprint(candidate) && payee.toLowerCase() !== candidate.toLowerCase();
}
