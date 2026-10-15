// src/internal/stellar-strkey.ts reads and writes G…, C… and M… strkeys without @stellar/stellar-sdk. Over generated
// keys and ids, ids 0 and 2^64 − 1 among them, accountKey, contractId, muxedOf and unmux give the keys, ids and strkeys
// the SDK's StrKey gives, and each refuses every malformed strkey the SDK refuses: a bad checksum, another version
// byte, another length, padding, a bit set past the last byte, and lowercase. The strkeys are written here with
// @scure/base's base32 and a CRC16-XModem of this file's own, which a control holds to the SDK's encoding.
import { sha256 } from "@noble/hashes/sha2.js";
import { base32 } from "@scure/base";
import { StrKey } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { accountKey, contractId, isAccount, isContract, muxedOf, unmux } from "../src/internal/stellar-strkey.js";
import { rowsOf } from "./rows.js";

const MUXED = 12 << 3;
const ACCOUNT = 6 << 3;
const CONTRACT = 2 << 3;

/** CRC16-XModem, bit by bit. */
function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    for (let bit = 7; bit >= 0; bit--) {
      const top = ((crc >> 15) & 1) ^ ((b >> bit) & 1);
      crc = (crc << 1) & 0xffff;
      if (top) crc ^= 0x1021;
    }
  }
  return crc;
}

/** The strkey of `version` and `payload`, its checksum's low byte XORed with `flip`, with base32's padding or without. */
function strkey(version: number, payload: Uint8Array, { flip = 0, padded = false } = {}): string {
  const body = Uint8Array.from([version, ...payload]);
  const crc = crc16(body) ^ flip;
  const text = base32.encode(Uint8Array.from([...body, crc & 0xff, crc >> 8]));
  return padded ? text : text.replace(/=+$/, "");
}

/** A 32-byte key and an 8-byte id, as the 40-byte payload of an M… strkey. */
function muxedPayload(key: Uint8Array, id: bigint): Uint8Array {
  const raw = new Uint8Array(40);
  raw.set(key, 0);
  new DataView(raw.buffer).setBigUint64(32, id, false);
  return raw;
}

const keyOf = (i: number) => sha256(new TextEncoder().encode(`key ${i}`));
const idOf = (i: number) => new DataView(sha256(new TextEncoder().encode(`id ${i}`)).buffer).getBigUint64(0, false);

/** 256 generated keys, each with a generated id, then the edges: ids 0, 1, 2^63 and 2^64 − 1, and all-0 and all-1 keys. */
function sweep(): { key: Uint8Array; id: bigint }[] {
  const rows = Array.from({ length: 256 }, (_, i) => ({ key: keyOf(i), id: idOf(i) }));
  for (const id of [0n, 1n, 2n ** 63n, 2n ** 64n - 1n]) rows.push({ key: keyOf(1000), id });
  rows.push({ key: new Uint8Array(32), id: 0n }, { key: new Uint8Array(32).fill(0xff), id: 2n ** 64n - 1n });
  return rows;
}

describe("unmux without the SDK, held to the SDK's StrKey", () => {
  it("the strkeys written here are the SDK's (the control)", () => {
    for (const { key, id } of rowsOf(sweep(), "the sweep", { exact: 262 })) {
      const raw = muxedPayload(key, id);
      expect(strkey(MUXED, raw)).toBe(StrKey.encodeMed25519PublicKey(Buffer.from(raw)));
      expect(strkey(ACCOUNT, key)).toBe(StrKey.encodeEd25519PublicKey(Buffer.from(key)));
      expect(strkey(CONTRACT, key)).toBe(StrKey.encodeContract(Buffer.from(key)));
    }
  });

  it("a round trip over generated keys and ids, ids 0 and 2^64 − 1 among them", () => {
    for (const { key, id } of rowsOf(sweep(), "the sweep", { exact: 262 })) {
      const m = StrKey.encodeMed25519PublicKey(Buffer.from(muxedPayload(key, id)));
      const decoded = StrKey.decodeMed25519PublicKey(m);
      expect([m, unmux(m)]).toEqual([
        m,
        { base: StrKey.encodeEd25519PublicKey(Buffer.from(decoded.subarray(0, 32))), id: new DataView(decoded.buffer, decoded.byteOffset, 40).getBigUint64(32, false) },
      ]);
      expect(unmux(m)).toEqual({ base: StrKey.encodeEd25519PublicKey(Buffer.from(key)), id });
    }
  });

  it("each malformed strkey, which the SDK refuses too", () => {
    const raw = muxedPayload(keyOf(7), idOf(7));
    const good = strkey(MUXED, raw);
    const last = good.at(-1)!;
    // The last character carries 4 bits of the checksum and 1 bit past the last byte, which must be 0.
    const pastLast = good.slice(0, -1) + "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"["ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(last) | 1];
    const rows = [
      { case: "a checksum that does not match", s: strkey(MUXED, raw, { flip: 1 }) },
      { case: "a checksum whose high byte does not match", s: strkey(MUXED, raw, { flip: 0x100 }) },
      { case: "an account's version byte, at an M strkey's length", s: strkey(ACCOUNT, raw) },
      { case: "a signed payload's version byte, at an M strkey's length", s: strkey(15 << 3, raw) },
      { case: "an account strkey", s: strkey(ACCOUNT, raw.subarray(0, 32)) },
      { case: "a payload of 41 bytes", s: strkey(MUXED, Uint8Array.from([...raw, 0])) },
      { case: "a payload of 39 bytes", s: strkey(MUXED, raw.subarray(0, 39)) },
      { case: "one character short", s: good.slice(0, -1) },
      { case: "one character more", s: `${good}A` },
      { case: "base32's padding", s: strkey(MUXED, raw, { padded: true }) },
      { case: "a padding character in place of the last", s: `${good.slice(0, -1)}=` },
      { case: "a bit set past the last byte", s: pastLast },
      { case: "lowercase", s: good.toLowerCase() },
      { case: "an empty text", s: "" },
      { case: "a number", s: 7 },
      { case: "null", s: null },
    ];
    expect(unmux(good)).not.toBeNull();
    expect(pastLast).not.toBe(good);
    for (const row of rowsOf(rows, "the malformed strkeys", { exact: 16 })) {
      expect([row.case, unmux(row.s)]).toEqual([row.case, null]);
      expect([row.case, StrKey.isValidMed25519PublicKey(row.s as string)]).toEqual([row.case, false]);
    }
  });
});

describe("accountKey, contractId and muxedOf without the SDK, held to the SDK's StrKey", () => {
  it("a round trip over generated keys: G… and C… strkeys, and the M… strkey of each G… strkey and id", () => {
    for (const { key, id } of rowsOf(sweep(), "the sweep", { exact: 262 })) {
      const g = StrKey.encodeEd25519PublicKey(Buffer.from(key));
      const c = StrKey.encodeContract(Buffer.from(key));
      expect([g, accountKey(g), isAccount(g), contractId(g), isContract(g)]).toEqual([g, Uint8Array.from(StrKey.decodeEd25519PublicKey(g)), true, null, false]);
      expect([c, contractId(c), isContract(c), accountKey(c), isAccount(c)]).toEqual([c, Uint8Array.from(StrKey.decodeContract(c)), true, null, false]);
      expect([g, id, muxedOf(g, id)]).toEqual([g, id, StrKey.encodeMed25519PublicKey(Buffer.from(muxedPayload(key, id)))]);
      expect(unmux(muxedOf(g, id))).toEqual({ base: g, id });
      expect(muxedOf(c, id)).toBeNull();
    }
  });

  // 56 characters hold 35 bytes exactly, so no bit lies past the last byte of a G… or C… strkey.
  it("each malformed G… or C… strkey, which the SDK refuses too", () => {
    const key = keyOf(9);
    const rowsFor = (version: number) => {
      const good = strkey(version, key);
      return {
        good,
        rows: [
          { case: "a checksum that does not match", s: strkey(version, key, { flip: 1 }) },
          { case: "a checksum whose high byte does not match", s: strkey(version, key, { flip: 0x100 }) },
          { case: "another version byte at the same length", s: strkey(version === ACCOUNT ? CONTRACT : ACCOUNT, key) },
          { case: "a signed payload's version byte at the same length", s: strkey(15 << 3, key) },
          { case: "a muxed account", s: strkey(MUXED, muxedPayload(key, 7n)) },
          { case: "a payload of 33 bytes", s: strkey(version, Uint8Array.from([...key, 0])) },
          { case: "a payload of 31 bytes", s: strkey(version, key.subarray(0, 31)) },
          { case: "one character short", s: good.slice(0, -1) },
          { case: "one character more", s: `${good}A` },
          { case: "padding after the last character", s: `${good}====` },
          { case: "a padding character in place of the last", s: `${good.slice(0, -1)}=` },
          { case: "lowercase", s: good.toLowerCase() },
          { case: "an empty text", s: "" },
          { case: "a number", s: 7 },
          { case: "null", s: null },
        ],
      };
    };
    const account = rowsFor(ACCOUNT);
    expect(accountKey(account.good)).toEqual(key);
    for (const row of rowsOf(account.rows, "the malformed G strkeys", { exact: 15 })) {
      expect([row.case, accountKey(row.s), muxedOf(row.s, 7n)]).toEqual([row.case, null, null]);
      expect([row.case, StrKey.isValidEd25519PublicKey(row.s as string)]).toEqual([row.case, false]);
    }
    const contract = rowsFor(CONTRACT);
    expect(contractId(contract.good)).toEqual(key);
    for (const row of rowsOf(contract.rows, "the malformed C strkeys", { exact: 15 })) {
      expect([row.case, contractId(row.s)]).toEqual([row.case, null]);
      expect([row.case, StrKey.isValidContract(row.s as string)]).toEqual([row.case, false]);
    }
  });
});
