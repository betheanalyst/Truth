export interface Verdict {
  verdict: string;
  confidence: number;
  sources: string[];
  explanation: string;
}

export interface Claim {
  id: string;
  submitter: string;
  content: string;
  is_checked: boolean;
  verdict: Verdict | null;
}
