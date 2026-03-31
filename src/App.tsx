/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { createClient, chains, createAccount, generatePrivateKey } from 'genlayer-js';
import { Search, ShieldCheck, AlertCircle, ExternalLink, Loader2, Wallet, CheckCircle2, XCircle, HelpCircle, ChevronRight, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CONTRACT_ADDRESS, RPC_URL } from './lib/genlayer';
import { Claim } from './types';

declare global {
  interface Window {
    ethereum?: any;
  }
}

export default function App() {
  const [localAccount, setLocalAccount] = useState<any>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [pendingClaims, setPendingClaims] = useState<(Partial<Claim> & { txHash?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<'idle' | 'sending' | 'consensus' | 'finalizing'>('idle');
  const [newClaimContent, setNewClaimContent] = useState('');
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nodeError, setNodeError] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Initialize Local Wallet on mount
  useEffect(() => {
    let pk = localStorage.getItem('truthlayer_pk') as `0x${string}`;
    if (!pk) {
      pk = generatePrivateKey();
      localStorage.setItem('truthlayer_pk', pk);
    }
    try {
      const account = createAccount(pk);
      setLocalAccount(account);
    } catch (err) {
      console.error('Failed to initialize local account:', err);
      // Fallback: generate new one if stored one is invalid
      const newPk = generatePrivateKey();
      localStorage.setItem('truthlayer_pk', newPk);
      setLocalAccount(createAccount(newPk));
    }
  }, []);

  // Initialize client
  const getClient = useCallback(() => {
    return createClient({
      chain: chains.studionet,
      endpoint: RPC_URL,
      account: localAccount,
    });
  }, [localAccount]);

  const fetchClaims = useCallback(async () => {
    try {
      setLoading(true);
      const client = getClient();
      console.log('Fetching claims from contract...');
      
      // Fetch a larger range to ensure we don't miss new claims
      const result = await client.readContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: 'get_claims_paginated',
        args: [0, 50]
      });
      
      console.log('Raw Fetch result:', result);
      
      let fetchedClaims: Claim[] = [];
      if (Array.isArray(result)) {
        fetchedClaims = result;
      } else if (result && typeof result === 'object' && 'claims' in result && Array.isArray((result as any).claims)) {
        fetchedClaims = (result as any).claims;
      } else if (result && typeof result === 'object' && 'data' in result && Array.isArray((result as any).data)) {
        fetchedClaims = (result as any).data;
      }

      // Sort by ID descending (assuming numeric IDs) to show newest first
      const sortedClaims = [...fetchedClaims].sort((a, b) => {
        const idA = parseInt(a.id) || 0;
        const idB = parseInt(b.id) || 0;
        return idB - idA;
      });

      setClaims(sortedClaims);
      setLastUpdated(new Date());
      setNodeError(false);
      
      // Clear pending claims that have now been indexed
      // Using a more robust matching (submitter + partial content)
      if (sortedClaims.length > 0) {
        setPendingClaims(prev => prev.filter(p => {
          const isIndexed = sortedClaims.some(c => {
            const pContent = p.content?.toLowerCase()?.trim() || '';
            const cContent = c.content?.toLowerCase()?.trim() || '';
            
            // Match if content is identical OR if one is a significant prefix of the other
            const contentMatch = cContent === pContent || 
                               (pContent.length > 10 && cContent.startsWith(pContent.substring(0, 20))) ||
                               (cContent.length > 10 && pContent.startsWith(cContent.substring(0, 20)));
            
            const submitterMatch = c.submitter.toLowerCase() === p.submitter?.toLowerCase();
            return contentMatch && submitterMatch;
          });
          return !isIndexed;
        }));
      }
    } catch (err: any) {
      console.error('Fetch claims error:', err);
      // If it's a "contract state" error, it might be transient or gas related
      if (err.message && err.message.includes('state')) {
        setNodeError(true);
        setError('Note: The GenLayer node is currently having trouble reading the contract state. Your claims are safe on-chain, but might not display here immediately.');
      }
    } finally {
      setLoading(false);
    }
  }, [getClient]);

  useEffect(() => {
    fetchClaims();
  }, [fetchClaims]);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!localAccount || !newClaimContent.trim()) return;

    const contentToSubmit = newClaimContent.trim();
    const tempId = `pending-${Date.now()}`;

    try {
      setSubmitting(true);
      setSubmissionStatus('sending');
      setError(null);
      
      // Add to local pending list immediately
      const newPendingClaim = {
        id: tempId,
        content: contentToSubmit,
        submitter: localAccount.address,
        is_checked: false,
        verdict: null,
        txHash: ''
      };
      setPendingClaims(prev => [newPendingClaim, ...prev]);

      console.log('Submitting claim to GenLayer:', contentToSubmit);
      const client = getClient();
      
      // 1. Send the transaction
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: 'submit_and_verify',
        args: [contentToSubmit],
        value: 0n
      });
      
      console.log('Transaction hash received:', txHash);
      // Ensure we have a string hash
      const finalHash = typeof txHash === 'string' ? txHash : (txHash as any).hash || String(txHash);
      
      setPendingClaims(prev => prev.map(c => c.id === tempId ? { ...c, txHash: finalHash } : c));
      setSubmissionStatus('consensus');
      
      // 2. Wait for transaction receipt
      console.log('Waiting for AI consensus and transaction receipt for hash:', finalHash);
      const receipt = await client.waitForTransactionReceipt({ 
        hash: finalHash as `0x${string}`,
        interval: 5000,
        retries: 100 // Increased to ~8 minutes for slow AI consensus
      });
      
      console.log('Full Transaction receipt received:', JSON.stringify(receipt, null, 2));
      setSubmissionStatus('finalizing');

      // More resilient success check
      const status = String(receipt.status || (receipt as any).status || '').toLowerCase();
      const isSuccess = 
        status === 'success' || 
        status === '1' || 
        status === '0x1' ||
        status === 'confirmed';

      if (isSuccess || receipt.blockNumber) {
        console.log('Transaction confirmed as successful (or has block number)!');
        setNewClaimContent('');
        // Trigger multiple fetches to catch indexing
        setTimeout(() => fetchClaims(), 2000);
        setTimeout(() => fetchClaims(), 10000);
        setTimeout(() => fetchClaims(), 30000);
      } else {
        console.warn('Transaction status check failed, but receipt was received. Status:', receipt.status);
        if (status === 'reverted' || status === '0' || status === '0x0' || status === 'failure') {
          throw new Error('Transaction explicitly reverted on-chain. The AI models might have failed to reach consensus.');
        }
        
        console.log('Proceeding despite ambiguous status...');
        setNewClaimContent('');
        await fetchClaims();
      }
    } catch (err: any) {
      console.error('Submission error details:', err);
      
      // Only remove from pending if it's a user rejection or a hard revert
      if (err.message?.toLowerCase().includes('rejected') || err.message?.toLowerCase().includes('revert')) {
        setPendingClaims(prev => prev.filter(c => c.id !== tempId));
      }
      
      let errorMessage = 'Failed to verify claim.';
      
      if (err.message && err.message.includes('timeout')) {
        errorMessage = 'Verification is taking longer than expected. The AI models are still processing. Your claim will appear in the list once consensus is reached. Check the explorer for updates.';
      } else if (err.message) {
        if (err.message.includes('User rejected')) {
          errorMessage = 'Transaction was rejected.';
        } else {
          errorMessage += ` ${err.message}`;
        }
      }
      setError(errorMessage);
    } finally {
      setSubmitting(false);
      setSubmissionStatus('idle');
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

          <div className="flex items-center gap-4">
            {localAccount && (
              <div className="flex flex-col items-end">
                <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  {shortenAddress(localAccount.address)}
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(localAccount.address);
                    }}
                    className="hover:text-emerald-400 transition-colors"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}
          </div>
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
                disabled={!localAccount || submitting}
              />
              <div className="absolute right-2 top-2 bottom-2 flex items-center">
                <button
                  type="submit"
                  disabled={!localAccount || submitting || !newClaimContent.trim()}
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
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                Recent Verifications
                <span className="px-2 py-0.5 rounded-full bg-white/5 text-xs text-gray-500 border border-white/5">
                  {claims.length}
                </span>
              </h2>
              {lastUpdated && (
                <span className="text-[10px] text-gray-600 uppercase tracking-widest">
                  Last synced: {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-4">
              {nodeError && (
                <div className="flex items-center gap-1.5 text-xs text-amber-500/80 bg-amber-500/10 px-2 py-1 rounded-md border border-amber-500/20">
                  <AlertCircle className="w-3 h-3" />
                  Node Sync Issue
                </div>
              )}
              <button 
                onClick={fetchClaims}
                disabled={loading}
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-emerald-400 transition-colors disabled:opacity-50"
              >
                <Loader2 className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Refreshing...' : 'Refresh List'}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
              <p className="text-gray-500 animate-pulse">Loading claims from GenLayer...</p>
            </div>
          ) : (claims.length === 0 && pendingClaims.length === 0 && !submitting) ? (
            <div className="text-center py-20 border border-dashed border-white/10 rounded-3xl">
              <p className="text-gray-500">No claims verified yet. Be the first!</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {/* Show local pending claims */}
              {pendingClaims.map((claim) => (
                <motion.div
                  key={claim.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="group bg-white/5 border border-emerald-500/30 rounded-2xl p-6 relative overflow-hidden"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex-1">
                      <p className="text-lg font-medium line-clamp-1 mb-2 text-emerald-400/80">
                        {claim.content}
                      </p>
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border text-emerald-400 bg-emerald-400/10 border-emerald-400/20">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {submitting ? (
                            <>
                              {submissionStatus === 'sending' && 'Initializing...'}
                              {submissionStatus === 'consensus' && 'AI Consensus (30-60s)...'}
                              {submissionStatus === 'finalizing' && 'Updating Ledger...'}
                            </>
                          ) : (
                            'Awaiting Indexing...'
                          )}
                        </span>
                        <a 
                          href={claim.txHash ? `https://explorer-studio.genlayer.com/transactions/${claim.txHash}` : `https://explorer-studio.genlayer.com/transactions`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-gray-500 hover:text-emerald-400 flex items-center gap-1 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          {claim.txHash ? 'View Transaction' : 'Check Explorer'}
                        </a>
                        <button
                          onClick={() => setPendingClaims(prev => prev.filter(p => p.id !== claim.id))}
                          className="text-xs text-gray-600 hover:text-red-400 transition-colors ml-auto"
                          title="Remove from pending list"
                        >
                          Clear
                        </button>
                      </div>
                      </div>
                    </div>
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/5 to-transparent pointer-events-none" />
                </motion.div>
              ))}

              {/* Show verified claims */}
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
      
      {/* Footer */}
      <footer className="max-w-4xl mx-auto px-4 py-12 border-t border-white/5">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="text-xs text-gray-500">
              <p className="uppercase tracking-widest font-bold mb-1 opacity-50">Contract Address</p>
              <div className="flex items-center gap-2 font-mono">
                {CONTRACT_ADDRESS}
                <button 
                  onClick={() => navigator.clipboard.writeText(CONTRACT_ADDRESS)}
                  className="hover:text-emerald-400 transition-colors"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <a 
              href="https://studio.genlayer.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-gray-500 hover:text-emerald-400 flex items-center gap-1 transition-colors"
            >
              GenLayer Studio
              <ExternalLink className="w-3 h-3" />
            </a>
            <a 
              href="https://explorer-studio.genlayer.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-gray-500 hover:text-emerald-400 flex items-center gap-1 transition-colors"
            >
              Explorer
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </footer>

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
