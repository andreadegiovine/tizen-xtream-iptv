export const ErrorCode = Object.freeze({
  INVALID_INPUT: 'INVALID_INPUT',
  AUTH_FAILED: 'AUTH_FAILED',
  ACCOUNT_EXPIRED: 'ACCOUNT_EXPIRED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  HTTP: 'HTTP',
  BAD_RESPONSE: 'BAD_RESPONSE',
  MAX_CONNECTIONS: 'MAX_CONNECTIONS',
  PLAYER: 'PLAYER',
  STORAGE: 'STORAGE',
  ABORTED: 'ABORTED',
  UNKNOWN: 'UNKNOWN',
});

export const Severity = Object.freeze({
  BLOCKING: 'blocking',
  RECOVERABLE: 'recoverable',
  SILENT: 'silent',
});

const META = {
  INVALID_INPUT: [Severity.RECOVERABLE, false],
  AUTH_FAILED: [Severity.BLOCKING, false],
  ACCOUNT_EXPIRED: [Severity.BLOCKING, false],
  ACCOUNT_DISABLED: [Severity.BLOCKING, false],
  NETWORK: [Severity.RECOVERABLE, true],
  TIMEOUT: [Severity.RECOVERABLE, true],
  HTTP: [Severity.RECOVERABLE, true],
  BAD_RESPONSE: [Severity.RECOVERABLE, true],
  MAX_CONNECTIONS: [Severity.RECOVERABLE, true],
  PLAYER: [Severity.RECOVERABLE, true],
  STORAGE: [Severity.RECOVERABLE, false],
  ABORTED: [Severity.SILENT, false],
  UNKNOWN: [Severity.RECOVERABLE, false],
};

/** One error type for the whole app: code + severity + retryable + i18n key. */
export class AppError extends Error {
  constructor(code, message, { cause, details } = {}) {
    super(message || code);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
    this.details = details || {};
    const [severity, retryable] = META[code] || META.UNKNOWN;
    this.severity = severity;
    this.retryable = retryable;
  }

  get i18nKey() {
    return `error.${this.code}`;
  }
}

export function toAppError(err) {
  if (err instanceof AppError) return err;
  return new AppError(ErrorCode.UNKNOWN, err && err.message, { cause: err });
}
