// SPDX-License-Identifier: Apache-2.0

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  FREIGHTER_ID,
  type ISupportedWallet,
} from "@creit.tech/stellar-wallets-kit";
import { appConfig, TESTNET_PASSPHRASE } from "./config";

interface WalletContextValue {
  address: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Signs an unsigned XDR with the connected wallet, returning signed XDR. */
  signTransaction: (xdr: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const STORAGE_KEY = "sidereal.wallet.id";

function networkFor(passphrase: string): WalletNetwork {
  return passphrase === TESTNET_PASSPHRASE ? WalletNetwork.TESTNET : WalletNetwork.PUBLIC;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const cfg = useMemo(() => appConfig(), []);
  const [kit, setKit] = useState<StellarWalletsKit | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // The kit touches `window`, so it can only be constructed in the browser.
  useEffect(() => {
    const instance = new StellarWalletsKit({
      network: networkFor(cfg.networkPassphrase),
      selectedWalletId: FREIGHTER_ID,
      modules: allowAllModules(),
    });
    setKit(instance);

    const savedId = window.localStorage.getItem(STORAGE_KEY);
    if (savedId) {
      instance.setWallet(savedId);
      instance
        .getAddress()
        .then(({ address: addr }) => setAddress(addr))
        .catch(() => window.localStorage.removeItem(STORAGE_KEY));
    }
  }, [cfg.networkPassphrase]);

  const connect = useCallback(async () => {
    if (!kit) return;
    setConnecting(true);
    try {
      await kit.openModal({
        onWalletSelected: async (option: ISupportedWallet) => {
          kit.setWallet(option.id);
          const { address: addr } = await kit.getAddress();
          setAddress(addr);
          window.localStorage.setItem(STORAGE_KEY, option.id);
        },
      });
    } finally {
      setConnecting(false);
    }
  }, [kit]);

  const disconnect = useCallback(() => {
    setAddress(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  const signTransaction = useCallback(
    async (xdr: string): Promise<string> => {
      if (!kit || !address) {
        throw new Error("connect a wallet first");
      }
      const { signedTxXdr } = await kit.signTransaction(xdr, {
        address,
        networkPassphrase: cfg.networkPassphrase,
      });
      return signedTxXdr;
    },
    [kit, address, cfg.networkPassphrase],
  );

  const value = useMemo(
    () => ({ address, connecting, connect, disconnect, signTransaction }),
    [address, connecting, connect, disconnect, signTransaction],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (ctx === null) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return ctx;
}
