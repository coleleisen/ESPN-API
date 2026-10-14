class AdvisorError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.code = code;
    this.publicMessage = message;
    this.status = status;
  }
}
module.exports = { AdvisorError };
