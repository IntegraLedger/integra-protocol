module.exports = {
  forbidden: [
    {
      name: "kernel-is-zero-dep",
      comment: "kernel depends on nothing — the narrow-engine boundary.",
      severity: "error",
      from: { path: "^packages/kernel/src" },
      to: { path: "node_modules|^packages/(?!kernel)" },
    },
    {
      name: "core-tier-no-upward",
      comment:
        "§3: the protocol CORE (kernel, binding-core) never imports domain or product packages — no upward edges. `verify` belongs to the DOMAIN tier below, not here: it orchestrates the §7.1 walk over authority.isWithin plus injected adapters, so it consumes domain packages by design (a domain→domain edge). It still sits in the §12 fixed RELEASE group with the core — release lockstep is not a dependency tier.",
      severity: "error",
      from: { path: "^packages/(kernel|binding-core)/src" },
      to: { path: "^packages/(?!kernel|binding-core)" },
    },
    {
      name: "viem-isolated",
      severity: "error",
      comment:
        "viem/abitype live ONLY in binding-evm-common and the EVM adapters (x402, escrow, mpp). No package outside that set may reach for them. The escrow drift guard also imports viem and is covered by the same allowance, being inside binding-evm-escrow; it is dev-only and never shipped, so the `files` allowlist keeps it out of the tarball rather than this rule.",
      from: {
        path: "^packages/(?!binding-evm-common|binding-evm-x402|binding-evm-escrow|binding-evm-mpp)",
      },
      to: { path: "node_modules/(viem|abitype)" },
    },
    {
      name: "solana-isolated",
      severity: "error",
      comment:
        "@solana/* lives ONLY in binding-solana, mirroring viem-isolated — the Solana SDK never leaks into other packages.",
      from: { path: "^packages/(?!binding-solana)" },
      to: { path: "node_modules/@solana" },
    },
    {
      name: "sui-isolated",
      severity: "error",
      comment: "@mysten/* lives ONLY in binding-sui, mirroring viem-isolated.",
      from: { path: "^packages/(?!binding-sui)" },
      to: { path: "node_modules/@mysten" },
    },
    {
      name: "stellar-isolated",
      severity: "error",
      comment:
        "@stellar/* lives ONLY in binding-stellar, mirroring viem-isolated.",
      from: { path: "^packages/(?!binding-stellar)" },
      to: { path: "node_modules/@stellar" },
    },
    {
      name: "aptos-isolated",
      severity: "error",
      comment:
        "@aptos-labs/* lives ONLY in binding-aptos, mirroring viem-isolated.",
      from: { path: "^packages/(?!binding-aptos)" },
      to: { path: "node_modules/@aptos-labs" },
    },
    {
      name: "domain-tier-no-upward",
      comment:
        "§3: domain packages never import the harness — the domain half of the tier graph the core-tier rule promised. swc drops the type-only tag, so this bans TYPE imports up-tier too; that ban is DELIBERATE (the port types domain packages need live in binding-core). A legitimate exception is a `to.pathNot` carve-out on the specific module, never a dependencyTypesNot exemption (inert under swc). placements and placement-* are both enumerated because a family the `from` regex does not name sits OUTSIDE the tier discipline entirely — free to import conformance unnoticed — which is a silent gap rather than a loud one. `placements` is listed BEFORE `placement-` and is not covered by it: the hyphen does not match `placements/`, which is exactly how the placement registry escaped this rule until the enumeration was widened.",
      severity: "error",
      from: {
        path: "^packages/(binding-|discovery|evidence|authority|verify|placements|placement-)",
      },
      to: { path: "^packages/(conformance|rail-invariants)" },
    },
    {
      name: "placement-packages-are-chain-free",
      severity: "error",
      comment:
        "A reference placement describes WHERE a reference rides in a protocol document. It has no settlement, so it has no chain: viem, abitype, and any binding-evm-* package are forbidden. A placement that needs a chain has been mis-classified — it is a rail binding (P8 §2). The viem/abitype half overlaps viem-isolated deliberately: that rule states where viem MAY live, this one states what a placement IS, and a reader looking for the placement invariant finds it here. The binding-evm-* half is genuinely new — nothing else stops a domain package importing an EVM adapter. `placements` (the registry) is inside the same invariant: it aggregates placements and nothing else, so a chain edge there would put viem behind the one import every caller is told to use.",
      from: { path: "^packages/(placements|placement-[^/]+)/src" },
      to: { path: "(^packages/binding-evm-|node_modules/(viem|abitype))" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.base.json" },
    // ⛔⛔ `parser: "swc"` REQUIRES `@swc/core` TO BE INSTALLED, AND A MISSING ENGINE CRUISES ZERO.
    // Measured 2026-08-27: with `parser: "swc"` declared and `@swc/core` absent, depcruise prints
    // `✔ no dependency violations found (0 modules, 0 dependencies cruised)` and EXITS 0 — a wholly
    // vacuous gate that is the same colour as a passing one. `depcruise-gate.mjs`'s module floor is what
    // actually catches that; this comment cannot fail a build.
    // ⚠️ An older form of this note claimed the tsc parser "cruises ZERO modules under TS 7". That is
    // NOT what happens and it was never measured: depcruise's `meta.cjs` declares `typescript
    // ">=2.0.0 <7.0.0"`, so under TS 7 `tscShouldUse()` is false and it falls back to ACORN, whose
    // loose recovery still finds the imports. Re-measured on this workspace, tsc / acorn / swc all
    // cruise the identical module count. swc is kept because it resolves one extra edge and does not
    // rely on error-recovery guesswork — a preference, not a rescue.
    parser: "swc",
    // enhancedResolveOptions is LOAD-BEARING. Without it depcruise cannot resolve pnpm-linked
    // workspace packages (`exports` map behind a symlink); it reports couldNotResolve, and every
    // rule whose `to:` matches a PATH (`^packages/...`) then silently matches nothing — a vacuous
    // gate reporting "no dependency violations found" while a real tier violation sits in the tree.
    // Third-party `node_modules/...` rules resolve without it, EXCEPT deep subpath imports
    // (@mysten/sui/transactions) and some exports-map packages (@aptos-labs/ts-sdk).
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
      extensions: [
        ".js",
        ".mjs",
        ".cjs",
        ".ts",
        ".mts",
        ".cts",
        ".d.ts",
        ".json",
      ],
    },
  },
};
