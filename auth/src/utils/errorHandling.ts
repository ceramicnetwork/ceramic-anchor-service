export class ClientFacingError extends Error {
    constructor(message) {
      super(message);
    }
}

export class VerificationUnavailableError extends Error { }
