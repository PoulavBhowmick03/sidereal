# Testnet deployment provenance

This document records the source and bytecode provenance of Sidereal testnet
deployments. Contract addresses and hashes are public. No signing keys or secret
material belong here.

## Deployment found on 2026-06-27

The deployment recorded in `app/.env.local` was generated at
`2026-06-27T04:11:11Z` by the local `sidereal-deployer` identity.

| Component | Address |
| --- | --- |
| Underlying SAC | `CAZSVSISHCMAPID6HQUYVNQVE3ZKDTRVPGPXD4PO7Z2B2NYGSHYQOGRS` |
| SY wrapper | `CC6EGWPK5NYRSERHFUEOP5XHOURT2PHCHF5O7WUR7QNPEYREXRJYU3MS` |
| PT token | `CDVXAZCU6C4GGWFO6MDNTHOKGEBHNGRHXCDNOOSF7EH4BV233BNBXDTA` |
| YT token | `CBIZSB3OKNQAJXLRG3LINQN3PBIQ4ON2KFB4HNN37C5EGBDJXXKUM7RN` |
| Tokenizer | `CAWLV6T37HMGTAN7EWNQD5FUKMCNCR4OFEAFT7IL57WATR72Z47HAM2G` |
| AMM | `CBQYNTB6ZSKY75WACQ773L2BFX6RUPV66VABYRND7CN26TMBNQ7FB2O3` |

Deployer public address:
`GBGHELMOABS7WCYOMJTWQRGQ6VZYLYXXMLE7JJAHJ6I4WW7FMJSDERN3`.

### Finding

The live AMM was not built from a committed source state. Its on-chain Wasm
hash is:

```text
6006b9629b34dfa3d3a82557b9d06f5e72f6c75043dbbd8195a1cd5c9a2fd3ef
```

That hash exactly matches both the AMM artifact left in the original worktree
at `target/wasm32v1-none/release/sidereal_amm.wasm` and a clean rebuild of the
uncommitted integer fixed-point rewrite. The rebuilt file is byte-for-byte
identical to the deployed artifact.

The committed float implementations produce different hashes:

| Candidate source | Soroban SDK lock | AMM Wasm hash | Match |
| --- | --- | --- | --- |
| `f958f0c13fbbd1ba45f5eb49c343c1bf0345f2e0` | 26.0.0 | `63394b49ef17956f007a4a80613360e63330e8d7725afe3eb3f415297301ef44` | No |
| `db5d0d4f770c51dcbb2e81ecabed3cf688f0fac0` | 26.1.0 | `48b18e8cf37787ceae79e9b40079503a2e7a0dc6fe8490e6c6e6a39ab0012129` | No |
| `db5d0d4` plus the dirty integer AMM rewrite | 26.1.0 | `6006b9629b34dfa3d3a82557b9d06f5e72f6c75043dbbd8195a1cd5c9a2fd3ef` | Yes |

Commits `fb2a6d1`, `f958f0c`, and `9fac0be` share the same AMM source and
pre-dependency-bump lockfile for this comparison. Commits `db5d0d4` and
`ae99ef4` share the same committed AMM source and post-dependency-bump lockfile.

The deploy script was also uncommitted. It was recovered from:

```text
/private/tmp/claude-501/-Users-odinson-Developer-sidereal/b803fc1a-dc58-492f-b158-0752a4c98bdf/scratchpad/deploy-resilient.sh
```

It includes the AMM `--yt_token` argument missing from the committed script and
uses the addresses listed above. It builds from the mutable working tree and
does not record a source commit, which caused this provenance gap.

### Reproduction environment

```text
rustc 1.96.0 (ac68faa20 2026-05-25)
cargo 1.96.0 (30a34c682 2026-05-25)
stellar 27.0.0 (5a7c5fe76530bf4248477ac812fc757146b98cc4)
host aarch64-apple-darwin
target wasm32v1-none
```

The comparison used release builds with the candidate commit's own
`Cargo.lock`:

```bash
cargo build --release --target wasm32v1-none --locked -p sidereal-amm
stellar contract info hash --wasm target/wasm32v1-none/release/sidereal_amm.wasm
stellar contract info hash \
  --id CBQYNTB6ZSKY75WACQ773L2BFX6RUPV66VABYRND7CN26TMBNQ7FB2O3 \
  --network testnet
```

## Required policy for the next deployment

The next deployment must use a clean, committed source revision. The deployment
record must include the full source commit, tool versions, deployer public
address, timestamp, all contract addresses, and the hash of every uploaded
Wasm artifact. Each on-chain hash must be read back and compared before the
deployment is marked active.
