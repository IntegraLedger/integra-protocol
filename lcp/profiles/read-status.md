**LCP profile `read-status`: what a read of a landed payment or agreement answers, and the rules that choose the answer.**

A pairing whose payment or agreement lands on a public ledger has a read, `status`, and a recovery, `recover`. Both read the ledger through a reader the caller supplies; the package calls no network on its own. This profile states what `status` takes, what identifies the act it is asked about, the answers and their reasons, and the rules that choose between them. Each pairing's own profile states how its read finds what these rules name: the single-use value its payer signs, the search for H, the marks of its ledger, the account an act names and what it moved. The vectors are `read-status.json`, and those of the agreement's value (rule 1) are `core-vectors.json`'s `agreementValue`.

**What `status` takes**

1. The **reference**: the network, the payer and the single-use value the payer signed (an authorization nonce, a sequence number or ticket, an account nonce, or a transaction id where the ledger derives it from the signed content alone; for an agreement on a pairing whose single-use value is H itself or H's low bits, the **agreement's value**: SHA-256 over the 16 ASCII bytes `lcp-agreement-v1` followed by H's 32 bytes, written as H is, `0x` and 64 lowercase hex digits, or that digest's low bits where the pairing takes H's low bits, so that an agreement and a payment under one H never share a single-use value), by which the read finds the payer's own act; and the **option's payee**, which the pairing's `reference` takes from the option the payment answers, given beside the presented payment. The payee is the key of the read's two party tests (rules 8 and 9) and is no search key. The reference holds no member whose only use is to compare an amount or an asset with the option.
2. The **act** asked about: `payment` or `agreement`. An agreement is the payer's own act under an option offered as an agreement; a payment is the pairing's charge. For an agreement on a pairing whose single-use value is H itself or H's low bits, the single-use value the read takes is the agreement's value (rule 1), which that pairing's profile places where it places H.
3. The **finality** asked for: one of the pairing's marks, the states of a transaction its endpoints tell apart, from the lowest, the transaction included at the head of the ledger, to the final one. Where a ledger's endpoints name no such states, its marks are counts of confirmations and the final one is the ledger's own security parameter.
4. Where the caller gives one, a **position** the transaction must come after, in the pairing's own spelling of a ledger position. The caller gives it only as a final position: the read cannot tell whether a position is final, and reads the one given as final.
5. For a search, the **search position** an earlier `pending` answer returned. The next call takes it as given, and the search resumes from it.
6. Where the caller gives them, **other acts under the same H**, each by its reference or by its transaction, none of which is the act asked about. An agreement and the charge it is made for are two such acts.

**What identifies the act**

7. The act is identified by its binding and its parties, and by nothing else it carries:
   - **its binding:** the ledger verified the payer's own signature over the bytes that hold H, or, for an agreement on the pairings rule 2 names, over its own single-use value; a log or a transfer a third party can cause is never that act. At coverage `none`, the act is the transaction the reference names;
   - **success:** the ledger records the transaction as succeeded, as the pairing's profile defines success;
   - **its pairing, network and kind:** the reference's pairing and network, and the act's kind;
   - **its position:** a ledger position after the one the caller gives, where the caller gives one.
8. **The signer is not the option's payee**, on either act. An act the payee signed is no act of the payer's, whatever it moved.
9. **For the act `payment`, the act names the payee's account**, the account the option names, as the pairing identifies the destination of an act: a transfer to that account, one of the act's transfers where it makes several, whatever amount or asset it moved, zero included; or an opening, a deposit into a contract, or an activation that names that account as its beneficiary or recipient. A transfer to another account names no payee, zero included, and neither does an act that names no account. An agreement is a proof and not a payment, and is held to no account.
10. **The read compares nothing else** the act moved with the option: neither its amount, its asset nor its time. An act that meets rules 7 to 9 is the act asked about whatever amount or asset it moved, and is answered `settled` with what it moved. What a payment pays is checked by the verification of the party asked to settle it, by its protocol, and by no read.
11. An act the caller names as another act under the same H (rule 6) is never the act asked about.

**The answer**

12. `status` answers one of four states, with one reason from a closed list:

| State | Reason | Means |
|---|---|---|
| `settled` | | the act asked about, read at the finality asked for or above it |
| `pending` | `below-mark` | the act found, and not yet at the finality asked for; or a transaction whose facts would answer `failed` found below the final mark |
| | `instrument-live` | the read holds the single-use value and reads it unconsumed at the final mark, its validity not passed or absent: the signed act can still land |
| | `search-incomplete` | the search has range left to read; or it passed an item it cannot decode and found nothing else that decides, its position held at that item; or the value was read consumed and the search has not found the transaction that consumed it |
| | `not-found` | the lookup or the search was read whole, the endpoint answered in the form it documents for a missing item, and the read cannot read the single-use value |
| `failed` | `instrument-unused` | the validity passed with the single-use value unconsumed |
| | `instrument-consumed` | another transaction consumed the single-use value |
| | `transaction-failed` | the act was included with a failed result that consumed the single-use value |
| | `before-position` | the act is at or before the position the caller gave |
| `unreadable` | `history-gap` | the reader did not show that it holds the history the act would be in |
| | `transport` | a read did not complete |
| | `unparseable` | an answer, or an item the read asked about or found carrying H, could not be decoded |
| | `too-large` | an answer exceeded the reader's bound |
| | `chain-mismatch` | the reader answers for another network than the reference's |

13. With its state and reason the answer gives: the transaction it names, where it names one; its ledger position in the pairing's own spelling; the finality it read at; what moved, as observed, each transfer or deposit with its asset, amount and recipient, an act that moved nothing giving none; the signer and any authority the ledger records for the signer; on a `pending` answer, the search position, where the search has one; and the foreign items the read met. An `instrument-consumed` answer names the transaction that consumed the value and what it moved, and, where that transaction carries H, the reason of rule 14 that holds for it.

**Foreign items**

14. A foreign item is a transaction that carries H, succeeded, and is not the act asked about, for which one of these reasons holds. It is named with the first that holds:

| Reason | The transaction |
|---|---|
| `payee-signed` | is signed by the option's payee |
| `other-signer` | carries H under the signature of another account than the one the reference names for the act |
| `given` | is one of the other acts under the same H the caller gave |
| `other-kind` | is an act of another pairing or kind than the act asked about |
| `other-account` | is an act `payment` that does not name the option's payee's account: a transfer to another account, or an act that names none |

15. A transaction that carries H and did not succeed, whoever signed it, is no foreign item, and neither is one for which no reason holds: a second act of the payer that meets every test of the act asked about, where the answer settles on another, is named in no answer. A stranger's transfer to the payee carries no H and is no foreign item. A foreign item decides nothing, and never stops a search. Each reason is worded by the act, the reference and the option, and names no party beyond payer and payee.

**The rules that choose the answer**

16. `before-position` is decided before any other reason: a transaction at or before the position the caller gave that would otherwise settle the act, consume its single-use value, or answer `transaction-failed` answers `failed`, `before-position`. A read that cannot place such a transaction against the position given does not settle on it: it answers `pending`, `search-incomplete`.
17. `failed` comes only from a read at the ledger's final mark, whatever finality was asked for. Below it, the same facts answer `pending`, `below-mark`.
18. `not-found` is answered only where the reader shows that it holds the history the act would be in, by answering a read at the position the caller gave, or, where the caller gave none, by the statement its pairing's profile names; and only in the form the reader documents for a missing item. Otherwise the answer is `unreadable`, `history-gap`. An error, a pruned answer or a timeout is never absence.
19. `search-incomplete` carries the search's position, and the next call takes it. A search that passed an item it cannot decode and found nothing else that decides answers `search-incomplete`, its position held at that item, since it read the rest of its range; one such item never fails a read. An item the read asked about, or one found carrying H, that cannot be decoded is `unreadable`, `unparseable`.
20. Where a failed result leaves the single-use value unconsumed, the answer is `pending`, `instrument-live`, until the validity passes.
21. A transaction that succeeded and is not the act asked about decides nothing for it. It is the transaction of an `instrument-consumed` answer where it consumed the act's single-use value; a foreign item where it carries H and a reason of rule 14 holds, a payment act of the payer's that does not name the payee's account among them; and otherwise named in no answer. An act the caller names as another act under the same H is never settled on: it is the transaction of an `instrument-consumed` answer where it consumed the act's single-use value, and otherwise a foreign item.
22. The `pending` reasons are answered in one order, the first that holds: `below-mark`, `instrument-live`, `search-incomplete`, `not-found`.
23. A single-use value read consumed whose transaction the search has not found is never `failed` and never `not-found`: it is `pending`, `search-incomplete`. A read with no means to read the single-use value never answers `failed`, apart from `before-position`.
24. At coverage `full`, `failed`, for every reason but `before-position`, comes only once the search for H is read whole and has found no act asked about. An act it finds is answered `settled`; a search not read whole answers `pending`, `search-incomplete`.
25. The search for H covers every act of the payer in the pairing and network that carries H, whatever it moved, from the position the caller gives to the latest head the endpoint serves at the read. One found above the final head answers `pending`, `below-mark`. A search an index narrows to one asset, payee or token is never read whole. A search whose completeness rests on a fact the pairing's profile states as not yet shown proves no absence until a run shows that fact.
26. Where the single-use value is H, or a value derived from H alone, and the payer holds one such value for the pairing's every asset on the network, the read of that value at the final mark and at the latest head is the search. A nonce each token keeps for itself, as EIP-3009's is, is not. Every other pairing's search is the one its profile states; where its profile states none, the read answers `pending`, `search-incomplete`, where it would answer `failed`.

**Recovery**

27. `recover` reads H back from a landed transaction for any holder of an ATR and a transaction id. It takes `{network, tx, option}`: the network, the transaction id in the pairing's spelling, and the chosen x402 option or MPP challenge as the ATR's binding slot holds it. Which member of the option the read needs is the pairing's, stated in its profile. It returns the value the transaction carries in H's place: H, or H's low bits where the pairing carries them; and from an agreement's transaction on a pairing whose agreement has its own value (rule 2), the agreement's value (rule 1), since a digest is not read back to H. A holder of the ATR computes the agreement's value from its own H and compares the two.

**The read kit**

28. The vectors of this profile are the cases common to every pairing's read, each on both acts where the act changes the answer. A pairing's own vectors run the same cases through its reader, those at the pairing's coverage, on the act `agreement` only where its payment can be an agreement. They leave a case out only where the pairing's profile states that the case cannot arise on its ledger; a case left out without that statement fails.
