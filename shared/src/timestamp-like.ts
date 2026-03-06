// Proxy for firebase Timestamp definition, so that frontend and backend can share models
export interface TimestampLike {
  readonly seconds: number
  readonly nanoseconds: number
  toDate(): Date
  toMillis(): number
  // optional: only if you use it
  isEqual?(other: unknown): boolean
}
