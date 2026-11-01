const { HttpError } = require('../utils/errors');

const notFound = (req, res) => res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}` } });

// One place that turns every failure into the status codes from the error-handling flowchart.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(err);
  let status = 500, message = 'Something went wrong', details;
  if (err instanceof HttpError) { status = err.status; message = err.message; details = err.details; }
  else if (err.type === 'entity.parse.failed') { status = 400; message = 'Malformed JSON body'; }
  else if (err.type === 'entity.too.large') { status = 413; message = 'Request body too large'; }
  else if (err.code === '23505') { status = 409; message = 'That record already exists'; }
  else if (err.code === '23503') { status = 409; message = 'A related record is missing or still in use'; }
  else if (['23514', '22P02', '22003', '23502'].includes(err.code)) { status = 400; message = 'Invalid value in request'; }
  else if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', '57P01', '08006', '08001', '53300'].includes(err.code) || /timeout exceeded|Connection terminated/i.test(err.message || '')) {
    status = 503; message = 'Service temporarily unavailable';
    console.error('[ALERT] database or connectivity failure:', err.message); // hook alerting (email/Slack) here
  } else { console.error(`[error] ${req.method} ${req.originalUrl}`, err); }
  res.status(status).json({ error: { message, ...(details ? { details } : {}) } });
}
module.exports = { notFound, errorHandler };
