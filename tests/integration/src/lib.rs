// SPDX-License-Identifier: Apache-2.0

//! Cross-contract integration tests for the sidereal protocol. The contracts
//! are unit-tested in isolation in their own crates; this crate registers all
//! of them together in one Soroban test environment and exercises the full user
//! journey across contract boundaries, asserting the PT + YT = SY invariant.
//!
//! Tests live under `tests/`.
