# Reproducible builds and deploy provenance

This document describes how Sidereal guarantees that a deployed contract's
bytecode can be traced back to a specific line of committed source, and how to
verify that yourself.

## The guarantee

For a mainnet deployment, the Wasm bytecode installed on chain is byte-for-byte
reproducible from a single committed revision. Anyone with the repository can
check out that revision, run one build command, and get artifacts whose sha256
matches both the manifest and the on-chain hash. Nothing about the deployed
bytecode depends on a developer's uncommitted working tree, local environment,
or one-off build flags.

Two inputs make the build deterministic and both are pinned in the repo:

- `rust-toolchain.toml` pins the Rust channel (currently 1.96.0).
- `Cargo.toml` `[profile.release]` pins the size and codegen settings that affect
  output bytes: `opt-level = "z"`, `lto = true`, `codegen-units = 1`,
  `panic = "abort"`, `strip = "symbols"`, `overflow-checks = true`. With
  `codegen-units = 1` the compiler does not split work across parallel units, so
  there is no partition ordering to vary between builds.

The final optimization pass (wasm-opt) is run by `stellar contract build`, so the
stellar-cli version is itself part of the build inputs. The manifest records it
under `[build].stellar_cli` for exactly this reason.

## Why this pipeline exists (the testnet lesson)

During the pre-mainnet audit, the testnet manifest at
`deployments/testnet.toml` recorded `source_commit = 27ce517...`, but a rebuild
of that commit reproduced only three of the five contract hashes. The `amm`,
`pt_token`, and `yt_token` artifacts matched; `sy_wrapper` and `tokenizer` did
not.

Root cause: the on-chain `sy_wrapper` and `tokenizer` were built from a dirty
working tree. The commit `750e6c3`, made hours after that deploy, changed only
`contracts/sy-wrapper/src/lib.rs` and `contracts/tokenizer/src/lib.rs`. Those
edits were already present, uncommitted, in the tree at deploy time. The three
contracts that reproduced were untouched between the recorded commit and
`750e6c3`, so their source matched; the two that changed did not. The manifest
recorded a clean commit while the deploy used dirty bytes for two contracts.

A secondary risk existed independently: at `27ce517` there was no
`[profile.release]` in `Cargo.toml` at all, so the release build used cargo
defaults (`codegen-units = 16`, no LTO). That did not cause this specific
mismatch (it would have affected all five contracts, not two), but it is the
kind of unpinned input that breaks reproducibility later. The profile is now
pinned (commits `b6e856c`, `5d03cf3`).

The mainnet process closes both gaps: builds only ever come from a clean,
committed revision, and the manifest records the toolchain and stellar-cli
versions so the exact build inputs are known.

## Verify a build reproduces from source

`scripts/verify-reproducible-build.sh` builds a committed revision in a
throwaway clean git worktree (never your working tree) and compares the results.

Prove the build is deterministic for the current HEAD:

```sh
scripts/verify-reproducible-build.sh --determinism
```

This builds HEAD twice from two independent clean checkouts and fails if any
contract hash differs between the runs.

Check that a deployed manifest reproduces from its recorded commit:

```sh
scripts/verify-reproducible-build.sh \
  --manifest deployments/mainnet.toml \
  --commit <source_commit>
```

This rebuilds the recorded commit and diffs the sha256 of each contract against
the manifest's `[wasm_hashes]`. It exits nonzero on any mismatch, and also
refuses to run if the commit you pass does not equal the manifest's
`source_commit`.

Just print the hashes for the current HEAD:

```sh
scripts/verify-reproducible-build.sh --print-only
```

The tool needs `git`, `cargo`, `stellar`, and `sha256sum` (or `shasum`). It does
not run the floating-point opcode check; that is a separate gate in
`scripts/check-wasm-floats.sh` and in CI.

## What CI asserts

The `reproducible-build` job in `.github/workflows/ci.yml` runs on every push
and pull request. It asserts two things:

1. Determinism. It builds the committed HEAD twice from clean worktrees and
   fails if the two builds are not byte-identical. This is the "same committed
   source produces the same hash" guarantee, checked continuously.
2. Manifest drift, conditionally. If `deployments/mainnet.toml` exists and its
   `source_commit` equals HEAD, it rebuilds and diffs against the recorded
   `[wasm_hashes]`. Any drift between committed source and the recorded manifest
   fails CI.

CI deliberately does not check HEAD against `deployments/testnet.toml`. Those
hashes belong to an older commit built before the release profile was pinned, so
HEAD is expected to differ from them. Checking that would make CI red on an
expected mismatch. The drift gate is scoped to a mainnet manifest recorded at
the commit under test.

## Mainnet deploy checklist

Follow this in order. Do not skip the clean-tree step.

1. Clean tree. `git status --porcelain` must be empty. The provenance recorder
   refuses to run otherwise.
2. Tag the commit. Create an annotated tag for the exact revision you will
   deploy, so the provenance has a human-readable anchor.
3. Build. Run `scripts/build-optimized-wasm.sh` from that clean, committed
   revision. This produces the optimized Wasm and rejects floating-point
   opcodes.
4. Hash and sanity-check locally. Optionally run
   `scripts/verify-reproducible-build.sh --print-only` and confirm the build is
   deterministic with `--determinism`.
5. Deploy. Deploy the built artifacts and initialize the contracts. Persist the
   contract addresses (the resilient deploy script writes them to a
   `deployments/<network>.state.env` state file).
6. Read back. For each deployed contract, read the on-chain Wasm hash from RPC
   and confirm it equals the local sha256.
7. Record. Run `scripts/record-deploy-provenance.sh` (with `NETWORK=mainnet`).
   It re-checks the clean tree, records `source_commit`, `source_repo`, the
   `[build]` toolchain and stellar-cli versions, per-contract `[wasm_hashes]`,
   and the `[onchain_hashes]` read back from RPC. It asserts local hash equals
   on-chain hash for every contract before writing.
8. Commit the manifest. Commit `deployments/mainnet.toml`. Do not commit the
   state file or `app/.env.local`; both are gitignored. Once the manifest is
   committed at the deployed commit, the CI drift gate becomes active for it.

No private keys ever go into a manifest, a state file, or any committed file.
Deployer identities come from `stellar keys generate` and only their public
address is recorded.
