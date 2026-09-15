import z from 'zod/v4'

export type WrappedSuccessResult<T> = { data: T; error: undefined }
export type WrappedErrorResult = { data: undefined; error: Error }
export type WrappedResult<R> = WrappedSuccessResult<R> | WrappedErrorResult

// pg-meta's error shape varies by version/deployment — the in-container sidecar
// can omit `code`/`formattedError` that the hosted service includes. Requiring
// them made the error PARSER throw a ZodError, masking the real database message
// (e.g. "permission denied for table buckets") behind a useless validation
// error. Keep `message` required; tolerate the rest.
export const databaseErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional().default(''),
  formattedError: z.string().optional().default(''),
})

export class PgMetaDatabaseError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
    public formattedError: string
  ) {
    super(message)
    this.name = 'PgMetaDatabaseError'
  }
}
