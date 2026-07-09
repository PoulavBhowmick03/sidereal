#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Verify that Sidereal contract Wasm reproduces byte-for-byte from committed
# source, and (optionally) that it matches the hashes recorded in a deployment
# manifest.
#
# The build always runs from a CLEAN git worktree of a committed revision, never
# from the local working tree. This is deliberate: the testnet manifest drift
# that motivated this pipeline came from artifacts built out of a dirty tree
# while the manifest recorded a clean commit. Verifying committed source only
# removes that whole failure class.
#
# Modes:
#   (default)        build the target commit once and diff the resulting sha256
#                    hashes against a manifest's [wasm_hashes]. Exit nonzero on
#                    any mismatch, or if the manifest's source_commit does not
#                    match the commit being built.
#   --determinism    build the target commit twice in two independent clean
#                    worktrees and assert the two hash sets are identical. No
#                    manifest needed. This is the CI reproducibility gate.
#   --print-only     build once and print the sha256 table, no diff. Exit 0.
#
# Usage:
#   scripts/verify-reproducible-build.sh [--manifest PATH] [--commit REF]
#   scripts/verify-reproducible-build.sh --determinism [--commit REF]
#   scripts/verify-reproducible-build.sh --print-only [--commit REF]
#
# Options:
#   --manifest PATH  manifest to diff against (default: deployments/mainnet.toml)
#   --commit REF     git revision to build (default: HEAD)
#   --determinism    build twice and assert identical hashes
#   --print-only     build once, print hashes, no diff
#   -h, --help       show this help

set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"

MANIFEST="${MANIFEST:-deployments/mainnet.toml}"
REF="HEAD"
MODE="diff"

# Contract crate name -> manifest [wasm_hashes] key.
contract_crates=(
  sidereal_sy_wrapper
  sidereal_pt_token
  sidereal_yt_token
  sidereal_tokenizer
  sidereal_amm
)
manifest_key_for() {
  case "$1" in
    sidereal_sy_wrapper) echo "sy_wrapper" ;;
    sidereal_pt_token)   echo "pt_token" ;;
    sidereal_yt_token)   echo "yt_token" ;;
    sidereal_tokenizer)  echo "tokenizer" ;;
    sidereal_amm)        echo "amm" ;;
    *) die "unknown contract crate: $1" ;;
  esac
}

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 not found"
}

usage() {
  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --manifest) MANIFEST="${2:?--manifest needs a path}"; shift 2 ;;
    --commit)   REF="${2:?--commit needs a ref}"; shift 2 ;;
    --determinism) MODE="determinism"; shift ;;
    --print-only)  MODE="print"; shift ;;
    -h|--help) usage 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

require_cmd git
require_cmd cargo
require_cmd stellar

# sha256 tool: coreutils sha256sum or BSD/macOS shasum.
if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  die "need sha256sum or shasum for hashing"
fi

# Resolve the target revision to a full, unambiguous commit id.
COMMIT="$(git rev-parse --verify "${REF}^{commit}" 2>/dev/null)" \
  || die "cannot resolve commit for ref '$REF'"

# Read a value from the top level of a TOML manifest (key = "value").
# Only matches keys appearing before the first [section] header.
manifest_top() {
  local file="$1" key="$2"
  awk -v k="$key" '
    /^\[/ { exit }
    $0 ~ "^"k"[[:space:]]*=" {
      sub(/^[^=]*=[[:space:]]*/, "")
      gsub(/"/, "")
      print
      exit
    }
  ' "$file"
}

# Read a key from the [wasm_hashes] table of a TOML manifest.
manifest_wasm_hash() {
  local file="$1" key="$2"
  awk -v k="$key" '
    /^\[wasm_hashes\]/ { inblk=1; next }
    /^\[/ { inblk=0 }
    inblk && $0 ~ "^"k"[[:space:]]*=" {
      sub(/^[^=]*=[[:space:]]*/, "")
      gsub(/"/, "")
      print
      exit
    }
  ' "$file"
}

# Build the given commit in a throwaway clean worktree; write optimized wasm to
# an absolute out-dir that survives worktree removal. Float-opcode checking is a
# separate concern (scripts/check-wasm-floats.sh, run by CI); skip it here so
# this tool depends only on git, cargo, stellar, and a sha256 utility.
build_commit() {
  local commit="$1" outdir="$2"
  local wt
  wt="$(mktemp -d "${TMPDIR:-/tmp}/sidereal-repro.XXXXXX")"
  log "Checking out $commit into clean worktree $wt"
  git worktree add --detach --force "$wt" "$commit" >/dev/null \
    || { rm -rf "$wt"; die "git worktree add failed for $commit"; }
  mkdir -p "$outdir"
  if [[ ! -f "$wt/scripts/build-optimized-wasm.sh" ]]; then
    git worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt"
    die "commit $commit has no scripts/build-optimized-wasm.sh; cannot verify"
  fi
  ( cd "$wt" && REPO="$wt" OPT_WASM_DIR="$outdir" SKIP_WASM_FLOAT_CHECK=1 \
      bash scripts/build-optimized-wasm.sh ) \
    || { git worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt"; \
         die "optimized build failed for $commit"; }
  git worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt"
}

# Populate an associative-style hash list into a temp file: "crate<TAB>sha256".
hash_table() {
  local outdir="$1" dest="$2" crate wasm h
  : > "$dest"
  for crate in "${contract_crates[@]}"; do
    wasm="$outdir/$crate.wasm"
    [[ -f "$wasm" ]] || die "expected artifact missing: $wasm"
    h="$(sha256_of "$wasm")"
    printf '%s\t%s\n' "$crate" "$h" >> "$dest"
  done
}

print_table() {
  local dest="$1" crate h
  log "sha256 of optimized contract Wasm ($COMMIT)"
  while IFS=$'\t' read -r crate h; do
    printf '  %-22s %s\n' "$crate" "$h"
  done < "$dest"
}

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/sidereal-repro-out.XXXXXX")"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

case "$MODE" in
  print)
    build_commit "$COMMIT" "$WORKDIR/a"
    hash_table "$WORKDIR/a" "$WORKDIR/a.hashes"
    print_table "$WORKDIR/a.hashes"
    ;;

  determinism)
    log "Determinism check: building $COMMIT twice from clean worktrees"
    build_commit "$COMMIT" "$WORKDIR/a"
    hash_table "$WORKDIR/a" "$WORKDIR/a.hashes"
    build_commit "$COMMIT" "$WORKDIR/b"
    hash_table "$WORKDIR/b" "$WORKDIR/b.hashes"
    print_table "$WORKDIR/a.hashes"
    if diff -u "$WORKDIR/a.hashes" "$WORKDIR/b.hashes" >/dev/null; then
      log "PASS: two independent builds of $COMMIT produced identical hashes"
    else
      warn "hash divergence between the two builds:"
      diff -u "$WORKDIR/a.hashes" "$WORKDIR/b.hashes" >&2 || true
      die "build is NOT byte-reproducible for $COMMIT"
    fi
    ;;

  diff)
    [[ -f "$MANIFEST" ]] || die "manifest not found: $MANIFEST"
    manifest_commit="$(manifest_top "$MANIFEST" source_commit)"
    if [[ -z "$manifest_commit" ]]; then
      die "manifest $MANIFEST has no source_commit; cannot verify"
    fi
    if [[ "$manifest_commit" != "$COMMIT" ]]; then
      die "manifest source_commit ($manifest_commit) != commit being built ($COMMIT).
Build the exact commit the manifest records: --commit $manifest_commit"
    fi
    build_commit "$COMMIT" "$WORKDIR/a"
    hash_table "$WORKDIR/a" "$WORKDIR/a.hashes"
    print_table "$WORKDIR/a.hashes"
    status=0
    while IFS=$'\t' read -r crate built; do
      key="$(manifest_key_for "$crate")"
      recorded="$(manifest_wasm_hash "$MANIFEST" "$key")"
      if [[ -z "$recorded" ]]; then
        warn "no [wasm_hashes].$key in $MANIFEST"
        status=1
        continue
      fi
      if [[ "$built" == "$recorded" ]]; then
        printf '  \033[1;32mok\033[0m   %-22s %s\n' "$key" "$built"
      else
        printf '  \033[1;31mFAIL\033[0m %-22s built=%s recorded=%s\n' \
          "$key" "$built" "$recorded"
        status=1
      fi
    done < "$WORKDIR/a.hashes"
    if [[ "$status" -ne 0 ]]; then
      die "reproducibility check failed against $MANIFEST"
    fi
    log "PASS: $COMMIT reproduces every [wasm_hashes] entry in $MANIFEST"
    ;;

  *) die "unknown mode: $MODE" ;;
esac
