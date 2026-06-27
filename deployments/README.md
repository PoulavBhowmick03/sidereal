# Deployments

This directory is for committed public deployment manifests.

After a successful reproducible testnet deployment, commit:

```text
deployments/testnet.toml
```

The manifest must include the source commit, deployer public key, deployed
contract addresses, local Wasm hashes, and on-chain Wasm hashes. Do not store
private keys or local CLI secrets here.
