/** Only these host-authored messages may cross the application SDK boundary. */
export class AppModelError extends Error {
  constructor(readonly code: 'MODEL_NOT_CONFIGURED' | 'MODEL_UNAVAILABLE' | 'MODEL_REQUEST_FAILED' | 'INVALID_REQUEST', message: string) { super(message) }
}
