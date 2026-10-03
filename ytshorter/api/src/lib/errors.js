// Codes d'erreur applicatifs, partagés entre api et worker.
export const CODES = {
  INVALID_URL: 'INVALID_URL',
  VIDEO_TOO_LONG: 'VIDEO_TOO_LONG',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  NO_SPEECH: 'NO_SPEECH',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  INTERNAL: 'INTERNAL',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  LINK_EXPIRED: 'LINK_EXPIRED',
  CONFLICT: 'CONFLICT',
  UNSUPPORTED_FILE: 'UNSUPPORTED_FILE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UPLOAD_NOT_FOUND: 'UPLOAD_NOT_FOUND',
  RESTYLE_IN_PROGRESS: 'RESTYLE_IN_PROGRESS',
  RESTYLE_UNAVAILABLE: 'RESTYLE_UNAVAILABLE',
  SUBTITLES_UNAVAILABLE: 'SUBTITLES_UNAVAILABLE',
};

export class AppError extends Error {
  constructor(code, message, statusCode = 400, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const badRequest = (code, message) => new AppError(code, message, 400);
export const notFound = (message = 'Ressource introuvable') => new AppError(CODES.NOT_FOUND, message, 404);
export const forbidden = (message = 'Accès refusé') => new AppError(CODES.FORBIDDEN, message, 403);
export const unauthorized = (message = 'Authentification requise') =>
  new AppError(CODES.UNAUTHORIZED, message, 401);
