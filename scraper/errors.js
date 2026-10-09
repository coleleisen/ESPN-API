class ScrapeError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.publicMessage = message;
    this.status = status;
  }
}

module.exports = { ScrapeError };
