import mongoose, { Schema, type Model } from 'mongoose';
import { Attempt, type AttemptProps } from '../../domain/attempt/Attempt.js';
import { ATTEMPT_STATUSES } from '../../domain/attempt/AttemptStatus.js';
import { AttemptId, LearnerId, ProblemId } from '../../domain/shared/ids.js';
import type { AttemptRepository } from '../../application/ports.js';

/**
 * MongoDB adapter for attempts.
 *
 * `submission` and `evaluation` are stored as opaque `Mixed` documents on
 * purpose. They are polymorphic value objects owned by the domain: a new
 * submission format or an extra feedback field should not require a migration,
 * and nothing queries inside them; the fields that *are* queried (learner,
 * problem, status, timestamps) are typed and indexed.
 */
interface AttemptDocument {
  _id: string;
  problemId: string;
  learnerId: string;
  attemptNumber: number;
  status: string;
  submission: unknown;
  evaluation: unknown;
  events: Array<{ at: Date; type: string; detail?: string }>;
  evaluationRuns: number;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  evaluatedAt: Date | null;
}

const attemptSchema = new Schema<AttemptDocument>(
  {
    _id: { type: String, required: true },
    problemId: { type: String, required: true },
    learnerId: { type: String, required: true },
    attemptNumber: { type: Number, required: true },
    status: { type: String, required: true, enum: [...ATTEMPT_STATUSES] },
    submission: { type: Schema.Types.Mixed, default: null },
    evaluation: { type: Schema.Types.Mixed, default: null },
    events: [{ at: Date, type: String, detail: String }],
    evaluationRuns: { type: Number, default: 0 },
    failureReason: { type: String, default: null },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
    submittedAt: { type: Date, default: null },
    evaluatedAt: { type: Date, default: null },
  },
  { versionKey: false, _id: false },
);

// The history view is the platform's most-read screen: one attempt list per
// learner per problem, newest first.
attemptSchema.index({ learnerId: 1, problemId: 1, createdAt: -1 });
attemptSchema.index({ learnerId: 1, createdAt: -1 });

export class MongoAttemptRepository implements AttemptRepository {
  private readonly model: Model<AttemptDocument>;

  constructor(connection: mongoose.Connection) {
    this.model =
      (connection.models.Attempt as Model<AttemptDocument>) ??
      connection.model<AttemptDocument>('Attempt', attemptSchema);
  }

  async save(attempt: Attempt): Promise<void> {
    const props = attempt.toProps();
    await this.model.updateOne(
      { _id: props.id },
      { $set: toDocument(props) },
      { upsert: true },
    );
  }

  async findById(id: AttemptId): Promise<Attempt | null> {
    const doc = await this.model.findById(id).lean<AttemptDocument>().exec();
    return doc ? toDomain(doc) : null;
  }

  async findByLearner(learnerId: LearnerId): Promise<readonly Attempt[]> {
    const docs = await this.model
      .find({ learnerId })
      .sort({ createdAt: -1 })
      .lean<AttemptDocument[]>()
      .exec();
    return docs.map(toDomain);
  }

  async findByLearnerAndProblem(
    learnerId: LearnerId,
    problemId: ProblemId,
  ): Promise<readonly Attempt[]> {
    const docs = await this.model
      .find({ learnerId, problemId })
      .sort({ createdAt: -1 })
      .lean<AttemptDocument[]>()
      .exec();
    return docs.map(toDomain);
  }

  async countByLearnerAndProblem(learnerId: LearnerId, problemId: ProblemId): Promise<number> {
    return this.model.countDocuments({ learnerId, problemId }).exec();
  }
}

function toDocument(props: AttemptProps): Omit<AttemptDocument, '_id'> {
  return {
    problemId: props.problemId,
    learnerId: props.learnerId,
    attemptNumber: props.attemptNumber,
    status: props.status,
    submission: props.submission,
    evaluation: props.evaluation,
    events: props.events.map((e) => ({ at: e.at, type: e.type, detail: e.detail })),
    evaluationRuns: props.evaluationRuns,
    failureReason: props.failureReason,
    createdAt: props.createdAt,
    updatedAt: props.updatedAt,
    submittedAt: props.submittedAt,
    evaluatedAt: props.evaluatedAt,
  };
}

function toDomain(doc: AttemptDocument): Attempt {
  return new Attempt({
    id: AttemptId(doc._id),
    problemId: ProblemId(doc.problemId),
    learnerId: LearnerId(doc.learnerId),
    attemptNumber: doc.attemptNumber,
    status: doc.status as AttemptProps['status'],
    submission: doc.submission as AttemptProps['submission'],
    evaluation: reviveEvaluation(doc.evaluation),
    events: doc.events.map((e) => ({
      at: new Date(e.at),
      type: e.type as AttemptProps['events'][number]['type'],
      ...(e.detail ? { detail: e.detail } : {}),
    })),
    evaluationRuns: doc.evaluationRuns,
    failureReason: doc.failureReason,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
    submittedAt: doc.submittedAt ? new Date(doc.submittedAt) : null,
    evaluatedAt: doc.evaluatedAt ? new Date(doc.evaluatedAt) : null,
  });
}

/** `Mixed` round-trips `generatedAt` as a string; the domain expects a Date. */
function reviveEvaluation(raw: unknown): AttemptProps['evaluation'] {
  if (!raw || typeof raw !== 'object') return null;
  const evaluation = raw as { generatedAt?: unknown };
  return {
    ...(raw as object),
    generatedAt: new Date(evaluation.generatedAt as string | number | Date),
  } as AttemptProps['evaluation'];
}
