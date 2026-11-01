/** HTTP-mapped API error. Lives apart from chain.ts so the lifecycle logic can be tested without loading chain configuration. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}
