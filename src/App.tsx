/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { createClient } from 'genlayer-js';
import { Search, ShieldCheck, AlertCircle, ExternalLink, Loader2, Wallet, CheckCircle2, XCircle, HelpCircle, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CONTRACT_ADDRESS, RPC_URL } from './lib/genlayer';
import { Claim } from './types';

declare global {
  interface Window {
    ethereum?: any;
  }
}

export default function App() {
  const [account, setAccount] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [newClaimContent, setNewClaimContent] = useState('');
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize client
  const getClient = useCallback((withAccount = false) => {
    return createClient({
      endpoint: RPC_URL,
      provider: withAccount ? window.ethereum : undefined,
    });
  }, []);

  const fetchClaims = useCallback(async () => {
    try {
      setLoading(true);
      const client = getClient();
      const result = await client.readContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: 'get_claims_paginated',
        args: [0, 10]
      });
      setClaims((result as Claim[]) || []);
    } catch (err) {
      console.error('Fetch claims error:', err);
    } finally {
      setLoading(false);
    }
  }, [getClient]);

  useEffect(() => {
    fetchClaims();
  }, [fetchClaims]);

  const connectWallet = async () => {
    if (!window.ethereum) {
      setError('Please install a wallet like MetaMask.');
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts.length > 0) {
        setAccount(accounts[0]);
      }
    } catch (err) {
      console.error('Wallet connection error:', err);
      setError('Could not connect wallet.');
    }
  };

  const pollClaimStatus = async (claimId: string) => {
    const interval = setInterval(async () => {
      try {
        const client = getClient();
        const claim = await client.readContract({
          address: CONTRACT_ADDRESS as `0x${string}`,
          functionName: 'get_claim',
          args: [claimId]
        }) as Claim;
        if (claim && claim.is_checked) {
          clearInterval(interval);
          setSubmitting(false);
          fetchClaims();
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 3000);
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!account || !newClaimContent.trim()) return;

    try {
      setSubmitting(true);
      setError(null);
      const client = getClient(true);
      
      // For write operations, we use writeContract
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: 'submit_and_verify',
        args: [newClaimContent],
        value: 0n
      });
      
      // Wait for transaction receipt to get the claimId
      const receipt = await client.waitForTransactionReceipt({ hash: txHash });
      
      // In GenLayer, the result of the function call is often in the receipt
      // If the contract returns the claimId, it should be in receipt.result
      const claimId = receipt.result as string;
      
      setNewClaimContent('');
      if (claimId) {
        pollClaimStatus(claimId);
      } else {
        // Fallback if claimId is not directly returned
        setSubmitting(false);
        fetchClaims();
      }
    } catch (err) {
      console.error('Submission error:', err);
      setError('Failed to submit claim.');
      setSubmitting(false);
    }
  };

  const getVerdictColor = (verdict: string | undefined) => {
    if (!verdict) return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
    const v = verdict.toLowerCase();
    if (v.includes('true') || v.includes('correct')) return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
    if (v.includes('false') || v.includes('incorrect')) return 'text-rose-400 bg-rose-400/10 border-rose-400/20';
    if (v.includes('misleading') || v.includes('partially')) return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
    return 'text-gray-400 bg-gray-400/10 border-gray-400/20';
  };

  const getVerdictIcon = (verdict: string | undefined) => {
    if (!verdict) return <HelpCircle className="w-4 h-4" />;
    const v = verdict.toLowerCase();
    if (v.includes('true') || v.includes('correct')) return <CheckCircle2 className="w-4 h-4" />;
    if (v.includes('false') || v.includes('incorrect')) return <XCircle className="w-4 h-4" />;
    if (v.includes('misleading') || v.includes('partially')) return <AlertCircle className="w-4 h-4" />;
    return <HelpCircle className="w-4 h-4" />;
  };

  const shortenAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-gray-100 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-[#0A0A0B]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              <ShieldCheck className="text-white w-5 h-5" />
            </div>
            <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              TruthLayer
            </span>
          </div>

          <button
            onClick={connectWallet}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all active:scale-95"
          >
            <Wallet className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium">
              {account ? shortenAddress(account) : 'Connect Wallet'}
            </span>
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        {/* Hero / Submit Section */}
        <section className="mb-16 text-center">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl font-bold mb-6 tracking-tight"
          >
            Verify the <span className="text-emerald-400">Truth</span> on Chain
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-gray-400 text-lg mb-10 max-w-2xl mx-auto"
          >
            Decentralized fact-checking powered by GenLayer. Submit any claim and get a verifiable verdict backed by AI consensus.
          </motion.p>

          <form onSubmit={handleSubmit} className="relative max-w-2xl mx-auto">
            <div className="relative group">
              <input
                type="text"
                value={newClaimContent}
                onChange={(e) => setNewClaimContent(e.target.value)}
                placeholder="Paste a claim or news headline to verify..."
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-5 pr-36 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all placeholder:text-gray-600"
                disabled={!account || submitting}
              />
              <div className="absolute right-2 top-2 bottom-2 flex items-center">
                <button
                  type="submit"
                  disabled={!account || submitting || !newClaimContent.trim()}
                  className="h-full px-6 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold transition-all disabled:opacity-50 disabled:hover:bg-emerald-500 flex items-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processing</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      <span>Verify Truth</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            {!account && (
              <p className="mt-3 text-sm text-amber-400/80 flex items-center justify-center gap-1">
                <AlertCircle className="w-4 h-4" />
                Please connect your wallet to verify claims
              </p>
            )}
            {error && (
              <p className="mt-3 text-sm text-rose-400 flex items-center justify-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {error}
              </p>
            )}
          </form>
        </section>

        {/* Dashboard / Claims List */}
        <section>
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              Recent Verifications
              <span className="px-2 py-0.5 rounded-full bg-white/5 text-xs text-gray-500 border border-white/5">
                {claims.length}
              </span>
            </h2>
            <button 
              onClick={fetchClaims}
              className="text-sm text-gray-500 hover:text-emerald-400 transition-colors"
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
              <p className="text-gray-500 animate-pulse">Loading claims from GenLayer...</p>
            </div>
          ) : claims.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-white/10 rounded-3xl">
              <p className="text-gray-500">No claims verified yet. Be the first!</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {claims.map((claim) => (
                <motion.div
                  key={claim.id}
                  layoutId={claim.id}
                  onClick={() => setSelectedClaim(claim)}
                  className="group bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/[0.07] transition-all cursor-pointer relative overflow-hidden"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-lg font-medium line-clamp-1 mb-2 group-hover:text-emerald-400 transition-colors">
                        {claim.content}
                      </p>
                      <div className="flex items-center gap-3">
                        <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${getVerdictColor(claim.verdict?.verdict)}`}>
                          {getVerdictIcon(claim.verdict?.verdict)}
                          {claim.is_checked ? claim.verdict?.verdict : 'Processing'}
                        </span>
                        {claim.is_checked && (
                          <span className="text-xs text-gray-500">
                            {(claim.verdict?.confidence || 0) * 100}% Confidence
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-gray-500">
                      <div className="text-right hidden md:block">
                        <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-0.5">Submitter</p>
                        <p className="text-xs font-mono">{shortenAddress(claim.submitter)}</p>
                      </div>
                      <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedClaim && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedClaim(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-[#121214] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-8">
                <div className="flex items-start justify-between mb-8">
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold border ${getVerdictColor(selectedClaim.verdict?.verdict)}`}>
                    {getVerdictIcon(selectedClaim.verdict?.verdict)}
                    {selectedClaim.is_checked ? selectedClaim.verdict?.verdict : 'Processing'}
                  </div>
                  <button 
                    onClick={() => setSelectedClaim(null)}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                  >
                    <XCircle className="w-6 h-6 text-gray-500" />
                  </button>
                </div>

                <h3 className="text-2xl font-bold mb-6 leading-tight">
                  {selectedClaim.content}
                </h3>

                {selectedClaim.is_checked ? (
                  <div className="space-y-8">
                    <div>
                      <h4 className="text-xs uppercase tracking-[0.2em] text-gray-500 font-bold mb-3">Explanation</h4>
                      <p className="text-gray-300 leading-relaxed">
                        {selectedClaim.verdict?.explanation}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-8">
                      <div>
                        <h4 className="text-xs uppercase tracking-[0.2em] text-gray-500 font-bold mb-3">Confidence</h4>
                        <div className="flex items-end gap-2">
                          <span className="text-3xl font-bold text-emerald-400">
                            {(selectedClaim.verdict?.confidence || 0) * 100}%
                          </span>
                          <span className="text-gray-600 text-sm mb-1">AI Consensus</span>
                        </div>
                      </div>
                      <div>
                        <h4 className="text-xs uppercase tracking-[0.2em] text-gray-500 font-bold mb-3">Submitter</h4>
                        <p className="text-gray-300 font-mono text-sm">{selectedClaim.submitter}</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs uppercase tracking-[0.2em] text-gray-500 font-bold mb-3">Sources</h4>
                      <div className="flex flex-wrap gap-2">
                        {selectedClaim.verdict?.sources.map((source, i) => (
                          <a
                            key={i}
                            href={source}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-sm text-gray-400 transition-all"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Source {i + 1}
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 gap-4">
                    <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
                    <p className="text-gray-400">Verification in progress...</p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
