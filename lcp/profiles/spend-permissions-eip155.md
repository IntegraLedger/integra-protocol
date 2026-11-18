**LCP profile `spend-permissions/eip155`: an account's approval of a Spend Permission whose `salt` is H, as the agreement of a sale.**

A Spend Permission lets a spender draw a token from an account, up to an allowance in each period between a start and an end, under the account's approval recorded by the SpendPermissionManager contract (`coinbase/spend-permissions` at `e0004e63`, `src/SpendPermissionManager.sol`; the line numbers below are that file's). Neither x402 nor MPP carries a Spend Permission, so this profile defines the whole exchange: the offer in a `402` response, the account's act, the return of the approved permission, the resource server's checks, and the read of the approval. Its codec is the entry point `@integraledger/lcp/spend-permissions`.

H rides in the permission's `salt`, all of H, a member of the EIP-712 hash the account signs or of the call the account makes. The pairing is at coverage `full`: the account's own act, on a public ledger, binds H. The approval moves nothing: its one act is an agreement, the sale's own, and never a charge. The spender's later draws (`spend`, `:420`) move money under terms already bound, and this profile defines no read of them.

**The wire**

1. Every integer member is written as a JSON string of decimal digits with no sign and no leading zero (`"0"` alone for zero), as Coinbase's developer platform writes the permission's members in the body of its `createSpendPermission` call (`@coinbase/cdp-sdk` 1.60.0, `src/client/evm/evm.ts:410-414`). An address is `0x` and 40 hex digits in either case, compared by its bytes. `extraData` is `0x` and an even number of hex digits. A network is `eip155:<chain id>`.
2. The permission has the nine members of the contract's `SpendPermission` (`:29-48`): `account`, `spender`, `token`, `allowance` (a uint160), `period`, `start` and `end` (each a uint48, seconds), `salt` (a uint256) and `extraData` (bytes). No other member is taken.

**The offer**

3. The resource server answers the request with `402` and a JSON body whose member `spendPermission` holds:
   - `network`, the network the permission is approved on;
   - `manager`, the address of the SpendPermissionManager there;
   - `permission`, every member of the permission but `account`: `spender` the resource server's own account, `token`, `allowance`, `period`, `start`, `end`, `salt` and `extraData`, `salt` being H written as rule 1 writes a uint256;
   - `accepts`, a non-empty array of distinct routes, each `"signature"` or `"transaction"` (rules 6 and 7);
   - `legalContext`, `{"type":"sha256","value":H,"legalContextUrl":L}`, L the link to the ATR.

   No other member is written in `spendPermission` or in `permission`, and the body holds no member but `spendPermission` and, on a refusal, `error` (rule 13). A body over 65,536 bytes as JSON is not read.
4. The offer meets the manager's own refusals, since one it refuses reverts every approval (`_approve`, `:630-653`): `token` is not the zero address (`ZeroToken`), `spender` is not the zero address (`ZeroSpender`), `period` and `allowance` are not zero (`ZeroPeriod`, `ZeroAllowance`), and `start` is less than `end` (`InvalidStartEnd`). `token` is not an ERC-721 contract (`ERC721TokenNotSupported`, `:634-639`): no codec can tell that without a read of the token, so the resource server offers only a token it knows is none. `advertise` and `read` refuse an offer that breaks any other of these.

**The account's act**

5. The client fetches the ATR from L, hashes it, and compares the hash with H; it requires `salt` = H and `legalContext.value` = H, and otherwise signs nothing. It then adds `account`, the account that approves, which is never `spender`.
6. On the route `"signature"`, the account signs the permission as the EIP-712 typed data `SpendPermission(address account,address spender,address token,uint160 allowance,uint48 period,uint48 start,uint48 end,uint256 salt,bytes extraData)` (`:92-94`) in the manager's domain: `name` `"Spend Permission Manager"`, `version` `"1"` (`:772-775`), `chainId` the network's, and `verifyingContract` `manager`. The digest it signs is the manager's `getHash` of the permission (`:561-578`), the permission's hash.
7. On the route `"transaction"`, the account itself calls the manager's `approve` with the permission (`:277-283`), as `createSpendPermission` does through a user operation of the account (`@coinbase/cdp-sdk` 1.60.0, `src/client/evm/evm.ts:394-431`), and waits for that call to succeed.

**The return**

8. The client repeats the request with the header field `Spend-Permission`, whose value is the base64url without padding (RFC 4648 §5, in its canonical form) of the UTF-8 of a JSON object holding `network`, `manager`, the whole `permission`, `account` among its members, and exactly one of:
   - `signature`, the account's signature over the permission's hash, `0x` and its bytes in hex, which may be an ERC-1271 or ERC-6492 signature of a contract account; or
   - `transaction`, the hash of the transaction that carried the approval: for a user operation, the transaction that included it (`@coinbase/cdp-sdk` 1.60.0, `src/actions/evm/waitForUserOperation.ts:94`), never the user operation's own hash (`src/client/evm/evm.ts:424`).

   The value decodes to at most 65,536 bytes of well-formed UTF-8, one JSON object and nothing after it, nested at most 64 levels deep, holding no member the object does not name. A signature holds at most 8,192 bytes.

**The resource server's checks, before it submits or serves**

9. In this order, each refusing with its code (rule 13):
   1. the header decodes as rule 8 states (`spend-permissions/header-malformed`; a `signature` that is not 1 to 8,192 bytes of hex, `spend-permissions/signature-invalid`);
   2. `network`, `manager` and every member of `permission` but `account` equal the offer's, `salt` among them, so that `salt` is H (`spend-permissions/not-bound`);
   3. the route is one the offer's `accepts` names (`spend-permissions/route-not-accepted`);
   4. `account` is not `spender` (`spend-permissions/account-is-spender`): an approval the payee signs proves no agreement;
   5. `end` is later than the resource server's clock (`spend-permissions/ended`).

   The resource server also holds that `salt` is an H it issued for this request and has not seen used, from its own record.
10. On `"signature"`, the resource server then submits `approveWithSignature` (`:293-306`) itself, as spender, paying its fee; anyone may call it, and the manager verifies the account's signature over the permission's hash, reverting `InvalidSignature` where it fails. On `"transaction"`, nothing is submitted.
11. The transaction that should hold the approval, the one the return names or the resource server's own submission, is read: it holds the approval where its receipt's `status` is 1 and it holds the manager's `SpendPermissionApproved` for the permission's hash (`spend-permissions/not-approved` otherwise); where it holds none and the manager reads the permission revoked in the state after its block (`isRevoked`, `:485-487`), the code is `spend-permissions/revoked`.

**The proof**

12. The proof is the manager's `SpendPermissionApproved(bytes32 indexed hash, SpendPermission spendPermission)` (`:132`) in a transaction whose receipt's `status` is 1, found by `hash`, the permission's hash, its data holding the permission whole. The manager emits it once for a hash, on the approval that first marks the hash approved (`:655-665`): a repeat approval, and an approval of a revoked permission, return in a successful transaction with no event, and a reverted approval changes nothing. `_approve` compares no member with the block's time (`:630-666`), so an approval can land at any time, after `end` included, and the approval has no lapse. A revocation, by the account (`revoke`, `:397-399`) or by the spender (`revokeAsSpender`, `:406-411`), emits `SpendPermissionRevoked(bytes32 indexed hash, SpendPermission spendPermission)` (`:138`) once for a hash (`:675-684`), and a permission revoked before its approval can no longer be approved.

**Errors**

13. A return the resource server refuses is answered `402` with the offer again and one code, in the body's member `error` beside `spendPermission`, as x402's `PaymentRequired` carries its own: `spend-permissions/not-bound`, `spend-permissions/signature-invalid`, `spend-permissions/not-approved`, `spend-permissions/revoked` or `spend-permissions/ended`; and, for a return that does not decode, takes a route the offer does not accept or names `spender` as its `account`, the code rule 9 gives it.

**The read**

`status` reads the act `agreement`, the pairing's one act, through a JSON-RPC endpoint the caller supplies: a receipt, a transaction, `eth_call`, `eth_getLogs`, and blocks by mark with their times.

14. **The reference.** `reference` gives the network, `manager`, H (the permission's `salt`), the permission's hash, the permission whole as presented, `account` as the signer of H, `spender` as the option's payee, and, on `"transaction"`, the transaction the return names. It refuses a return whose `network`, `manager` or offered permission members differ from the offer it is given (`spend-permissions/not-bound`).
15. **The single-use value** is the permission's hash, which the manager marks approved once: `isApproved(permission)` or `isRevoked(permission)` (`:476-487`), read at the `finalized` block and at the latest block. It is consumed where either reads true. It has no lapse by time (rule 12), so the read answers no `instrument-unused`: an unapproved permission is `pending`, `instrument-live`, for as long as the caller asks.
16. **The search** reads the manager's logs `[SpendPermissionApproved, hash]` and `[SpendPermissionRevoked, hash]`, from the block after the position the caller gives to the latest head, in pages of at most 10,000 blocks, at most eight pages a call, and answers its position where range is left. Where the value reads consumed and the search finds no transaction that consumed it, the value is read at the position given, and, consumed there, the first block at which it reads consumed is found by halving, and the same two logs in that block name the transaction: `failed`, `before-position`.
17. **The act** is the transaction whose receipt's `status` is 1 and that holds the manager's `SpendPermissionApproved` for the hash, its permission decoding whole, hashing to the hash, and carrying `salt` = H. Its signer of H is the permission's `account`, never the transaction's sender, which may be the spender, a bundler or a relayer; the party tests read `account` against the reference's `account` and `spender`, the option's payee. It moved nothing, and its answer names nothing moved.
18. **A revocation** is the transaction that holds the manager's `SpendPermissionRevoked` for the hash: it consumed the value where no approval came first, and is the transaction of a `failed`, `instrument-consumed` answer once the search for the hash is read whole. Its signer is the account where the transaction's input holds the manager's `revoke` or `approveWithRevoke` call revoking the permission, the spender where it holds `revokeAsSpender`'s, and unread otherwise.
19. **`presented`** compares the permission whole, its nine members, as the approval's event carries it, with the permission the reference holds: `yes` where all are equal, `no` where one differs.
20. **Marks.** `latest`, `safe` and `finalized`; final `finalized`, a state the endpoint reports. `failed` is answered only at `finalized`. Asked about the act `payment`, which the pairing has none of, `status` answers `unreadable`, `unparseable`, with nothing read.

**The agreement**

21. The approval is an agreement and never a charge (`only`). Its floor is zero: it moves nothing. Its fee is paid by the party that submits it: the resource server, as spender, on `"signature"`; the account, or the paymaster its user operation names, on `"transaction"`. It succeeded where rule 17 holds. An approval whose `account` is the option's payee, the spender, is no agreement (rule 9, check 4).

**What a record proves**

22. That the account named signed a Spend Permission whose `salt` is this ATR's hash, naming the payee as spender, and that the SpendPermissionManager approved it: the hash is on chain in the permission the manager's `SpendPermissionApproved` event carries in the approval's transaction. The approval moves nothing; it does not show that any amount was later spent, nor that the allowance, period, token or timing match the ATR's content.

**The costs**

23. An approval the account makes of another permission carrying H is named in no answer unless the caller gives it, and decides nothing, being no act the offer constructs: the search reads only the events of the permission's hash.
24. An unapproved permission has no lapse: its read answers `pending`, `instrument-live`, for as long as the caller asks, and the resource server bounds how long it waits.
25. Whether `token` is an ERC-721 contract, which the manager refuses, and whether the account's signature verifies, which the manager checks when the approval is submitted, are not read before it: a return that passes rule 9 can still revert, and then the transaction holds no approval (rule 11).

**The vectors**

26. `vectors/spend-permissions-eip155.json` holds the permission's hash on two networks, the manager's typehash, selectors, event topics and call and event encodings, the offer the resource server places and the buyer reads, the typed data and the `approve` call `build` gives, both routes' headers, and a refusal row for each check of rules 3, 4, 8, 9, 11 and 14 and of `build`, each a good input with one member changed and the code the profile gives it. Every hash and encoding is viem 2.57.4's (`hashTypedData`, `toFunctionSelector`, `encodeFunctionData`, `encodeEventTopics`, `encodeAbiParameters`) over the types and ABI that SpendPermissionManager.sol states, and each header Node's base64url; no outside tool gives a refusal code, so each refusal row names the rule it follows. A recorded run on `eip155:84532` showed the exchange on the route `"transaction"`, a smart account's approval, through a user operation, of a permission whose `salt` is H, read `settled` at `finalized`; the pairing's `confirmed` is `yes`. No run has yet shown the route `"signature"`.

**The read kit**

27. Read for the act `agreement` alone. Declared inapplicable to the read kit, each with its reason:
    - `transaction-failed`, and the cases opening *a failed result that consumed the value*: a reverted transaction consumes no approval (rule 12).
    - `not-found`, and *a read with no means to read the single-use value* and *a read that did not read the value at the latest head*: the read holds its single-use value and reads it at a `finalized` block and at the latest block (rule 15).
    - `instrument-unused`: the approval has no lapse by time (rule 12).
    - *An act the read cannot place against the position given* (its three cases) and *an item the search could not decode that gives no position*: every log and receipt the read meets names its block.
    - *A payment act carrying H that transferred zero*, *an act carrying H that transferred zero*, *a payment act carrying H that moved another asset and amount*, *an act carrying H that transferred to another account* and *each transfer of what moved is named by its transaction and its place*: the approval moves nothing (rule 17).
    - *An act carrying H that names no account*, *an act the option's payee signed*, *an act carrying H under another account's signature*, *an act of another pairing or kind carrying H*, *a transaction for which two reasons hold*, *a second act of the payer that meets every test* and *the settled act's answer names every foreign item*: the search reads the manager's events for the permission's hash, which commits to every member of the permission as offered, `account` among them, which the exchange holds apart from `spender` (rule 9), and the manager emits `SpendPermissionApproved` once for a hash (rule 12), so every act the search meets is that permission's one approval, signed by its `account`; the cost is rule 23's.
    - Every case whose facts give a validity passed: the approval has no lapse by time (rule 12).
    - *A search that met an item it cannot decode*, *the answer names every item the search could not decode*, *the search's range left to read and an item it could not decode*, *an act the search found is settled, whatever items it could not decode* and *instrument-live is answered before an item the search could not decode*: the search meets only the manager's own events for the hash, written in the manager's ABI.
    - *An act whose signed message differs in a member from the payment presented*: the search keys on the permission's hash, which commits to every member `presented` compares (rule 19), so the act it meets is the permission presented.
    - *An act the caller gave as another act under the same H* that consumed nothing: the manager emits `SpendPermissionApproved` once for a hash, on the approval that consumes it (rule 12). The cost: the read does not fetch a transaction the caller gives, so such a transaction is named in no answer.

    *Search-incomplete is answered before not-found* arises: the search is a log search that can be left with range to read (rule 16), and its case is made with the approval in that range. A consumer of the value is the approval, which only the account makes or signs, so the read kit's case of a consumer another account signed is made as the account's.

