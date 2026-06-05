/** Raised when a Triton response tensor shape disagrees with the adapter's expected dims. */
export class ShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShapeError'
  }
}

/** Raised when a tensor dtype or byte count doesn't match the adapter's expected wire format. */
export class DtypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DtypeError'
  }
}

/**
 * Raised when adapter-side decoding logic fails (e.g. argmax on empty slice, malformed BYTES).
 *
 * Note: classifyError maps these to ModelErrorCode values. Error messages are
 * truncated to 200 chars and stack traces are stripped before storage — this class
 * carries only the message; callers must not embed sensitive data in error messages.
 */
export class DecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecodeError'
  }
}
