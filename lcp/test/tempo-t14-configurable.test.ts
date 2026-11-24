// Tempo T14's configurable accounts sign with the `0x05` signature type: `0x05` ‖ rlp([account, config, approvals]).
// The fixture holds transactions and key authorizations a T14 node included (and one it rejected), recorded on a real
// node; lcp must name the account the node named, and refuse the `0x05` forms that carry no account to name.
import { fromRlp, toRlp, type Hex as ViemHex } from "viem";
import { describe, expect, it } from "vitest";
import { keyAuthorizationSigner, tempoSender } from "../src/internal/tempo-envelope.js";
import F from "./fixtures/tempo-t14-configurable.json" with { type: "json" };

type Entry = { id: string; kind: string; node: string; account: string; hex: string };
const entries = F.entries as Entry[];
const bytes = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h.slice(2), "hex"));
const entry = (id: string) => entries.find((e) => e.id === id)!;
const malformed = { refused: true, code: "tempo/tx-malformed" };

/** The `0x76` envelope `wire` with its sender signature replaced by `signature`. */
function withSignature(wire: string, signature: ViemHex): Uint8Array {
  const items = fromRlp(`0x${wire.slice(4)}`) as unknown[];
  return bytes(`0x76${toRlp([...items.slice(0, -1), signature] as never).slice(2)}`);
}
/** A `0x05` signature over the parts given, each an RLP value as viem's toRlp takes it. */
const configurable = (parts: unknown): ViemHex => `0x05${toRlp(parts as never).slice(2)}`;

describe("Tempo T14: a configurable account's 0x05 signature", () => {
  const k1 = entry("k1/transaction");
  const sig = (fromRlp(`0x${k1.hex.slice(4)}`) as unknown[]).at(-1) as ViemHex;
  const [account, config, approvals] = fromRlp(`0x${sig.slice(4)}`) as [ViemHex, unknown[], ViemHex[]];

  it("the fixture's own control: the node included a 0x05 transaction from each owner set, and a single-key one", () => {
    expect(sig.slice(0, 4)).toBe("0x05");
    expect(account).toBe(k1.account);
    for (const e of entries.filter((x) => x.kind !== "ka" && x.id !== "control/valid-single-key" && x.node === "included")) {
      expect(e.hex.slice(0, 4)).toBe("0x76");
    }
  });

  it("tempoSender names the account the node named, for every transaction it included, the single-key control among them", () => {
    const included = entries.filter((e) => (e.kind === "tx" || e.kind === "open") && e.node === "included");
    expect(included.map((e) => e.id)).toEqual(expect.arrayContaining(["control/valid-single-key", "k1/transaction", "k2of2/transaction", "p256/transaction", "webauthn/transaction", "initial/transaction", "k1/session/open"]));
    for (const e of included) expect(tempoSender(bytes(e.hex)), e.id).toBe(e.account.toLowerCase());
  });

  it("keyAuthorizationSigner names the account whose keychain the node gave the key, for each owner set and the single-key control", () => {
    const included = entries.filter((e) => e.kind === "ka" && e.node === "included");
    expect(included).toHaveLength(5);
    for (const e of included) expect(keyAuthorizationSigner(bytes(e.hex)), e.id).toBe(e.account.toLowerCase());
  });

  it("re-encoding the signature unchanged names the same account; each form with no account to name is tempo/tx-malformed", () => {
    expect(tempoSender(withSignature(k1.hex, configurable([account, config, approvals])))).toBe(k1.account);
    const cases: [string, ViemHex][] = [
      ["no approvals", configurable([account, config, []])],
      ["nine approvals", configurable([account, config, Array(9).fill(approvals[0])])],
      ["an approval of 64 bytes", configurable([account, config, [approvals[0]!.slice(0, 130)]])],
      ["an approval that is a list", configurable([account, config, [[approvals[0]]]])],
      ["a P256 approval one byte short", configurable([account, config, [`0x01${"11".repeat(128)}`]])],
      ["an account of 19 bytes", configurable([account.slice(0, 40), config, approvals])],
      ["the zero account", configurable([`0x${"00".repeat(20)}`, config, approvals])],
      ["an account that is a list", configurable([[account], config, approvals])],
      ["a config that is a byte string", configurable([account, "0x01", approvals])],
      ["two items", configurable([account, config])],
      ["four items", configurable([account, config, approvals, "0x"])],
      ["a byte string, not a list", configurable(account)],
      ["the type byte alone", "0x05"],
    ];
    for (const [name, s] of cases) expect(tempoSender(withSignature(k1.hex, s)), name).toEqual(malformed);
  });

  // The approvals are not verified and the account's stored commitment is not read, as a keychain signature's key is
  // not checked against the keychain: the node decides. So a 0x05 signature naming an account whose owners did not
  // sign is read as that account's, and the node rejects the transaction; a seller that broadcasts it is paid nothing.
  it("a 0x05 signature naming an account whose owners did not sign it is read as that account's: the node rejected it", () => {
    const forged = entry("design/forged-0x05-naming-another-account");
    expect(forged.node).toBe("rejected");
    expect(tempoSender(bytes(forged.hex))).toBe(forged.account.toLowerCase());
  });
});
