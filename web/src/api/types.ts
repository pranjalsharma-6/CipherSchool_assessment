export type Difficulty = 'easy' | 'medium' | 'hard';

export type AttemptStatus = 'draft' | 'queued' | 'evaluating' | 'evaluated' | 'failed';

export type SubmissionFormat = 'structured' | 'code' | 'diagram';

export interface ProblemSummary {
  id: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  summary: string;
  tags: string[];
  estimatedMinutes: number;
  requirementCount: number;
}

export interface Problem extends ProblemSummary {
  statement: string;
  constraints: string[];
  requirements: Array<{ id: string; text: string }>;
  discussionPrompts: string[];
  rubric: Array<{ id: string; label: string; weight: number }>;
}

export interface StructuredEntity {
  name: string;
  kind: 'class' | 'interface' | 'enum';
  responsibility: string;
  members: string[];
}

export interface StructuredRelationship {
  from: string;
  to: string;
  kind: string;
  cardinality?: string;
  note?: string;
}

export interface StructuredOperation {
  name: string;
  owner?: string;
  description: string;
}

export type Submission =
  | {
      format: 'structured';
      entities: StructuredEntity[];
      relationships: StructuredRelationship[];
      operations: StructuredOperation[];
      tradeoffs: string;
      assumptions: string;
    }
  | { format: 'code'; language: 'typescript' | 'java' | 'python'; source: string; tradeoffs: string }
  | { format: 'diagram'; source: string; tradeoffs: string };

export type FeedbackKind = 'strength' | 'gap' | 'suggestion' | 'pitfall' | 'question';

export interface FeedbackItem {
  id: string;
  kind: FeedbackKind;
  dimension: string;
  title: string;
  detail: string;
  source: 'deterministic' | 'llm';
  requirementId?: string;
}

export interface DimensionScore {
  dimension: string;
  label: string;
  score: number;
  weight: number;
  deterministicScore: number | null;
  llmScore: number | null;
  rationale: string;
}

export interface RequirementCoverage {
  requirementId: string;
  text: string;
  kind: 'stated' | 'implied';
  covered: boolean;
  matchedSignals: string[];
}

export interface Evaluation {
  overallScore: number;
  dimensionScores: DimensionScore[];
  feedback: FeedbackItem[];
  requirementCoverage: RequirementCoverage[];
  summary: string;
  degraded: boolean;
  degradedReason: string | null;
  evaluators: Array<{
    name: string;
    version: string;
    status: 'ok' | 'failed' | 'skipped';
    durationMs: number;
    error?: string;
  }>;
  generatedAt: string;
}

export interface AttemptEvent {
  at: string;
  type: string;
  detail?: string;
}

export interface Attempt {
  id: string;
  problemId: string;
  attemptNumber: number;
  status: AttemptStatus;
  pending: boolean;
  submission: Submission | null;
  evaluation: Evaluation | null;
  failureReason: string | null;
  events: AttemptEvent[];
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  evaluatedAt: string | null;
}

export interface AttemptSummary {
  id: string;
  problemId: string;
  attemptNumber: number;
  status: AttemptStatus;
  pending: boolean;
  format: SubmissionFormat | null;
  score: number | null;
  degraded: boolean;
  dimensionScores: Array<{ dimension: string; label: string; score: number }>;
  createdAt: string;
  submittedAt: string | null;
  evaluatedAt: string | null;
}

export interface Health {
  status: string;
  storage: string;
  reviewer: { mode: string; modelId: string | null; simulated: boolean };
  queueDepth: number;
}
