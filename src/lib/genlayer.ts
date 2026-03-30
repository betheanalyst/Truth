import { createClient } from 'genlayer-js';

export const RPC_URL = 'https://studio.genlayer.com/api';
export const CONTRACT_ADDRESS = '0xB145714a5599E7BD3E81C1A0B79A2BaCb28cA7D5';

export const client = createClient({
  endpoint: RPC_URL,
});
