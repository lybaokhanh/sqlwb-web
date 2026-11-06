/** HTTP error with the status code (409 = workspace saved from another tab). */
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
