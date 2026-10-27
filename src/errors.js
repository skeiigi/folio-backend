export class ApiError extends Error {
  constructor(status, message, code = "REQUEST_FAILED", details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const assert = (condition, status, message, code) => {
  if (!condition) throw new ApiError(status, message, code);
};
export const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
