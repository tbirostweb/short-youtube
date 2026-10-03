// Codes d'erreur du pipeline. Identiques à ceux exposés par l'api.
export const CODES = {
  INVALID_URL: 'INVALID_URL',
  VIDEO_TOO_LONG: 'VIDEO_TOO_LONG',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  NO_SPEECH: 'NO_SPEECH',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  INTERNAL: 'INTERNAL',
  RESTYLE_UNAVAILABLE: 'RESTYLE_UNAVAILABLE',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
};

// Messages destinés à l'utilisateur final : lisibles, sans détail technique.
export const USER_MESSAGES = {
  INVALID_URL: "L'URL fournie n'est pas une vidéo YouTube valide.",
  VIDEO_TOO_LONG: 'Cette vidéo dépasse la durée maximale autorisée.',
  DOWNLOAD_FAILED:
    "Le téléchargement de la vidéo a échoué. Elle est peut-être privée, géobloquée, réservée aux membres ou supprimée.",
  NO_SPEECH: "Aucune parole n'a été détectée dans cette vidéo : impossible de générer des sous-titres.",
  TRANSCRIPTION_FAILED: 'La transcription a échoué. Réessayez dans quelques minutes.',
  QUOTA_EXCEEDED:
    "Le quota gratuit des fournisseurs d'IA est atteint. Réessayez plus tard ou configurez un fournisseur de repli.",
  PROVIDER_ERROR: "Un fournisseur d'IA a renvoyé une réponse inexploitable. Réessayez.",
  INTERNAL: 'Une erreur interne est survenue pendant le traitement.',
  RESTYLE_UNAVAILABLE:
    "Les fichiers de découpe de ce job ont été nettoyés : le style ne peut plus être changé. Relancez une génération.",
  MODEL_UNAVAILABLE:
    "Le modèle d'IA configuré n'existe plus ou n'est pas accessible avec cette clé. Mettez à jour GEMINI_MODEL / GROQ_MODEL côté serveur.",
};

export class PipelineError extends Error {
  constructor(code, message, cause) {
    super(message || USER_MESSAGES[code] || code);
    this.name = 'PipelineError';
    this.code = code;
    this.userMessage = USER_MESSAGES[code] || this.message;
    if (cause) this.cause = cause;
  }
}

export const fail = (code, cause) => new PipelineError(code, USER_MESSAGES[code], cause);
