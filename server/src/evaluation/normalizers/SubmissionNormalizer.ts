import type { DesignModel } from '../../domain/attempt/DesignModel.js';
import type { Submission, SubmissionFormat } from '../../domain/attempt/Submission.js';
import { ValidationError } from '../../domain/shared/errors.js';

/**
 * Turns one submission format into the shared {@link DesignModel}.
 *
 * Strategy pattern, one implementation per format. Supporting a new way to
 * submit (an image with OCR, a JSON schema export, a repo link) is a new
 * class registered here; no evaluator, service or route changes.
 */
export interface SubmissionNormalizer<F extends SubmissionFormat = SubmissionFormat> {
  readonly format: F;
  normalize(submission: Extract<Submission, { format: F }>): DesignModel;
}

export class SubmissionNormalizerRegistry {
  private readonly normalizers = new Map<SubmissionFormat, SubmissionNormalizer>();

  constructor(normalizers: readonly SubmissionNormalizer[] = []) {
    for (const n of normalizers) this.register(n);
  }

  register(normalizer: SubmissionNormalizer): this {
    this.normalizers.set(normalizer.format, normalizer);
    return this;
  }

  supports(format: SubmissionFormat): boolean {
    return this.normalizers.has(format);
  }

  normalize(submission: Submission): DesignModel {
    const normalizer = this.normalizers.get(submission.format);
    if (!normalizer) {
      throw new ValidationError(`No normaliser registered for format '${submission.format}'`);
    }
    return (normalizer as SubmissionNormalizer<typeof submission.format>).normalize(
      submission as never,
    );
  }
}
