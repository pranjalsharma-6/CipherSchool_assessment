import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { AttemptId, LearnerId, ProblemId } from '../../domain/shared/ids.js';
import { NotFoundError, ValidationError } from '../../domain/shared/errors.js';
import { attemptDto, attemptSummaryDto, problemDto, problemSummaryDto } from './dto.js';
import { parseBody, parseSubmission } from './validation.js';

/**
 * Identifies the learner.
 *
 * The MVP has no accounts: a header (or a fallback) stands in. It is isolated
 * in this one function precisely so that adding real auth later is a change to
 * a single line rather than to every handler: everything downstream already
 * takes a `LearnerId` and scopes its queries by it.
 */
function learnerFrom(req: Request): LearnerId {
  const header = req.header('x-learner-id');
  return LearnerId(header && header.trim().length > 0 ? header.trim() : 'learner-demo');
}

/** Wraps an async handler so a rejection reaches the error middleware. */
const handle =
  <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: { json: (body: unknown) => void; status: (n: number) => any }, next: (e?: unknown) => void) => {
    try {
      res.json(await fn(req));
    } catch (error) {
      next(error);
    }
  };

export function createRoutes(container: Container): Router {
  const router = Router();
  const { attemptService, problems } = container;

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      storage: container.config.MONGODB_URI ? 'mongodb' : 'in-memory',
      reviewer: container.reviewer,
      queueDepth: container.queue.size(),
    });
  });

  router.get(
    '/problems',
    handle(async () => ({
      problems: (await problems.findAll()).map(problemSummaryDto),
    })),
  );

  router.get(
    '/problems/:idOrSlug',
    handle(async (req) => {
      const key = req.params.idOrSlug as string;
      const problem =
        (await problems.findBySlug(key)) ?? (await problems.findById(ProblemId(key)));
      if (!problem) throw new NotFoundError('Problem', key);
      return { problem: problemDto(problem) };
    }),
  );

  const startSchema = z.object({ problemId: z.string().min(1) });

  router.post(
    '/attempts',
    handle(async (req) => {
      const { problemId } = parseBody(startSchema, req.body);
      const attempt = await attemptService.start(learnerFrom(req), problemId);
      return { attempt: attemptDto(attempt) };
    }),
  );

  router.get(
    '/attempts',
    handle(async (req) => {
      const problemId = req.query.problemId;
      if (problemId !== undefined && typeof problemId !== 'string') {
        throw new ValidationError('problemId must be a single string value');
      }
      const attempts = await attemptService.history(learnerFrom(req), problemId);
      return { attempts: attempts.map(attemptSummaryDto) };
    }),
  );

  router.get(
    '/attempts/:id',
    handle(async (req) => {
      const attempt = await attemptService.get(
        AttemptId(req.params.id as string),
        learnerFrom(req),
      );
      return { attempt: attemptDto(attempt) };
    }),
  );

  router.put(
    '/attempts/:id/draft',
    handle(async (req) => {
      const attempt = await attemptService.saveDraft(
        AttemptId(req.params.id as string),
        learnerFrom(req),
        parseSubmission((req.body as { submission?: unknown })?.submission),
      );
      return { attempt: attemptDto(attempt) };
    }),
  );

  router.post(
    '/attempts/:id/submit',
    handle(async (req) => {
      const attempt = await attemptService.submit(
        AttemptId(req.params.id as string),
        learnerFrom(req),
        parseSubmission((req.body as { submission?: unknown })?.submission),
      );
      return { attempt: attemptDto(attempt) };
    }),
  );

  router.post(
    '/attempts/:id/reevaluate',
    handle(async (req) => {
      const attempt = await attemptService.retryEvaluation(
        AttemptId(req.params.id as string),
        learnerFrom(req),
      );
      return { attempt: attemptDto(attempt) };
    }),
  );

  return router;
}
