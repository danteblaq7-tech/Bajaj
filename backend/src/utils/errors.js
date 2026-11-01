class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const mk = (s) => (m, d) => new HttpError(s, m, d);
module.exports = {
  HttpError,
  badRequest: mk(400),
  unauthorized: mk(401),
  forbidden: mk(403),
  notFound: mk(404),
  conflict: mk(409),
  tooMany: mk(429),
  notImplemented: mk(501),
  unavailable: mk(503),
};
