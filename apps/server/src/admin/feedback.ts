/** The feedback inbox: read what players sent, and mark it resolved or new again (audited). */
import { FeedbackStore } from '../feedback.js';
import type { FeedbackStatus } from '../feedback.js';
import { FEEDBACK_CATEGORIES } from '../../../../packages/protocol/src/feedback.js';
import type { FeedbackCategory } from '../../../../packages/protocol/src/feedback.js';
import { AdminRequestError } from './api.js';
import type { AdminContext, ApiRoute } from './api.js';
import { immediate } from './audit.js';

export function feedbackRoutes(context: AdminContext): ApiRoute[] {
  const feedback = new FeedbackStore(context.store.db);
  return [
    {
      method: 'GET',
      path: /^\/api\/admin\/feedback$/,
      handle: ({ query }) => {
        const status = query.get('status') ?? 'new';
        if (!['new', 'resolved', 'all'].includes(status)) throw new AdminRequestError(400, 'INVALID_STATUS');
        const category = query.get('category') ?? 'all';
        if (category !== 'all' && !FEEDBACK_CATEGORIES.includes(category as FeedbackCategory))
          throw new AdminRequestError(400, 'INVALID_CATEGORY');
        const before = query.get('before');
        if (before !== null && !/^\d{1,12}$/.test(before)) throw new AdminRequestError(400, 'INVALID_CURSOR');
        return feedback.list({
          ...(status === 'all' ? {} : { status: status as FeedbackStatus }),
          ...(category === 'all' ? {} : { category: category as FeedbackCategory }),
          ...(before === null ? {} : { before: Number(before) }),
        });
      },
    },
    {
      method: 'POST',
      path: /^\/api\/admin\/feedback\/(\d{1,12})\/status$/,
      handle: (request) => {
        const { resolved } = request.body;
        if (typeof resolved !== 'boolean' || Object.keys(request.body).length !== 1)
          throw new AdminRequestError(
            400,
            'INVALID_BODY',
            'Send { "resolved": true } or { "resolved": false }',
          );
        const id = Number(request.params[0]);
        // The change and its audit row commit together.
        return immediate(context.store.db, () => {
          const current = feedback.get(id);
          if (!current) throw new AdminRequestError(404, 'FEEDBACK_NOT_FOUND', 'No such feedback');
          if ((current.status === 'resolved') === resolved) return current;
          const updated = feedback.setStatus(id, resolved, request.actor, context.now())!;
          request.audit({
            action: resolved ? 'feedback.resolve' : 'feedback.reopen',
            target: `feedback:${id}`,
            detail: { category: current.category, from: current.userId ?? null },
          });
          return updated;
        });
      },
    },
  ];
}
