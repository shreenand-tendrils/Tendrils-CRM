import { AppError } from '../errors/AppError.js';

/** Parse a request body with a zod schema; throws a 400 AppError on failure. */
export function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path?.join('.');
    throw new AppError(
      field ? `${field}: ${issue.message}` : issue?.message || 'Invalid request',
      400,
      'VALIDATION_ERROR'
    );
  }
  return result.data;
}
