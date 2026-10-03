// Textes de l'interface. Le français est la langue par défaut.
// La langue des métadonnées générées est un réglage indépendant du job.

export const messages = {
  fr: {
    'app.name': 'ytshorter',
    'app.tagline': 'Une vidéo YouTube, des clips verticaux prêts à publier.',
    'nav.new': 'Nouvelle génération',
    'nav.language': 'Langue de l’interface',
    'nav.skipToContent': 'Aller au contenu principal',

    'home.title': 'Transformez une vidéo en Shorts et TikToks',
    'home.subtitle':
      'Collez l’URL d’une vidéo YouTube. Les meilleurs passages sont repérés, découpés en 1080x1920, sous-titrés, et livrés avec leurs titres et descriptions.',
    'home.urlLabel': 'URL de la vidéo YouTube',
    'home.urlPlaceholder': 'https://www.youtube.com/watch?v=…',
    'home.urlHint': 'Formats acceptés : youtube.com/watch, youtu.be, youtube.com/shorts.',
    'home.submit': 'Générer les clips',
    'home.submitting': 'Création du job…',
    'home.options': 'Options',
    'home.optionsHint': 'Ces réglages s’appliquent à toute la génération.',
    'home.legalTitle': 'À remplir avant toute mise en ligne publique',
    'home.legalBody':
      '[Emplacement à compléter : mentions légales, conditions d’utilisation et politique de confidentialité.] Cet outil télécharge des vidéos YouTube, ce qui va à l’encontre des conditions d’utilisation de YouTube, et republier la vidéo d’un tiers pose une question de droits d’auteur. L’usage prévu est le recyclage de vos propres contenus.',

    'options.language': 'Langue des métadonnées',
    'options.languageHint': 'Langue des titres, descriptions et légendes générés.',
    'options.clipCount': 'Nombre de clips',
    'options.targetDuration': 'Durée cible par clip',
    'options.captionStyle': 'Style de sous-titres',
    'options.focus': 'Point de focus horizontal',
    'options.focusHint': 'Déplace la fenêtre de recadrage vers la gauche ou la droite.',
    'options.focusLeft': 'Gauche',
    'options.focusCenter': 'Centre',
    'options.focusRight': 'Droite',
    'options.seconds': 'secondes',
    'options.style.punch': 'Punch — majuscules, surbrillance jaune',
    'options.style.clean': 'Clean — sobre, surbrillance cyan',
    'options.style.boxed': 'Boxed — bandeau opaque',
    'options.style.none': 'Aucun — pas de sous-titres incrustés',

    // Ce que fait la machine à chaque étape : une attente expliquée passe mieux.
    'steps.desc.download': 'Récupération de la vidéo source.',
    'steps.desc.prepare': 'Lecture du fichier envoyé et vérification de la piste audio.',
    'steps.desc.transcribe': 'Reconnaissance de la parole, avec l’horodatage de chaque mot.',
    'steps.desc.select': 'Lecture de la transcription pour repérer les meilleurs passages.',
    'steps.desc.translate': 'Traduction des sous-titres des extraits retenus.',
    'steps.desc.cut': 'Découpe des extraits, avec une marge pour pouvoir les ajuster ensuite.',
    'steps.desc.render': 'Recadrage vertical, incrustation des sous-titres et encodage. L’étape la plus longue.',
    'steps.desc.metadata': 'Rédaction des titres, descriptions et hashtags.',
    'steps.desc.finalize': 'Nettoyage des fichiers intermédiaires.',
    'job.elapsed': 'Temps écoulé',

    'steps.queued': 'En attente',
    'steps.download': 'Téléchargement',
    'steps.transcribe': 'Transcription',
    'steps.select': 'Sélection des moments',
    'steps.cut': 'Découpe',
    'steps.render': 'Recadrage et sous-titres',
    'steps.metadata': 'Métadonnées',
    'steps.finalize': 'Finalisation',
    'steps.done': 'Terminé',
    'steps.error': 'Erreur',

    'job.title': 'Traitement en cours',
    'job.subtitle': 'Vous pouvez laisser cette page ouverte : la progression s’actualise en direct.',
    'job.progress': 'Progression',
    'job.currentStep': 'Étape en cours',
    'job.liveOff': 'Flux temps réel interrompu',
    'job.liveOffFallback': 'Flux temps réel interrompu : actualisation toutes les 3 secondes.',
    'job.slowNotice':
      'La transcription sans carte graphique est lente : comptez plusieurs minutes pour une vidéo longue.',
    'job.viewResults': 'Voir les clips',
    'job.retry': 'Réessayer',
    'job.backHome': 'Nouvelle génération',

    'results.title': 'Vos clips',
    'results.count': '{count} clip prêt | {count} clips prêts',
    'results.clipsWord': 'clips',
    'results.empty': 'Aucun clip pour ce job.',
    'results.sourceTitle': 'Vidéo source',
    'results.download': 'Télécharger le MP4',
    'results.hook': 'Accroche',
    'results.range': 'Extrait de {start} à {end}',
    'results.score': 'Score',
    'results.ytTitle': 'Titre YouTube Shorts',
    'results.ytDescription': 'Description YouTube Shorts',
    'results.ytHashtags': 'Hashtags YouTube',
    'results.tiktokCaption': 'Légende TikTok',
    'results.tiktokHashtags': 'Hashtags TikTok',
    'results.copy': 'Copier',
    'results.copied': 'Copié',
    'results.copyFailed': 'Copie impossible, sélectionnez le texte manuellement.',
    'results.videoUnsupported': 'Votre navigateur ne peut pas lire cette vidéo.',
    'results.newJob': 'Générer d’autres clips',
    'results.linkExpired': 'Les liens de téléchargement ont expiré. Actualisez la page.',

    'error.title': 'Le traitement a échoué',
    'error.INVALID_URL': 'Cette URL n’est pas une vidéo YouTube valide.',
    'error.VIDEO_TOO_LONG': 'Cette vidéo est trop longue pour être traitée.',
    'error.DOWNLOAD_FAILED':
      'Le téléchargement a échoué : vidéo privée, géobloquée, réservée aux membres ou supprimée.',
    'error.NO_SPEECH': 'Aucune parole détectée : impossible de générer des sous-titres.',
    'error.TRANSCRIPTION_FAILED': 'La transcription a échoué. Réessayez dans quelques minutes.',
    'error.QUOTA_EXCEEDED':
      'Le quota gratuit des fournisseurs d’IA est atteint. Réessayez plus tard.',
    'error.PROVIDER_ERROR': 'Le fournisseur d’IA a renvoyé une réponse inexploitable.',
    'error.RATE_LIMITED': 'Trop de demandes. Patientez quelques minutes avant de réessayer.',
    'error.VALIDATION_FAILED': 'Les options envoyées sont invalides.',
    'error.NOT_FOUND': 'Ce job est introuvable.',
    'error.FORBIDDEN': 'Ce job ne vous appartient pas.',
    'error.UNAUTHORIZED': 'Connectez-vous pour lancer une génération.',
    'error.LINK_EXPIRED': 'Ce lien a expiré. Actualisez la page.',
    'error.INTERNAL': 'Une erreur interne est survenue.',
    'error.NETWORK': 'Serveur injoignable. Vérifiez votre connexion.',
    'error.ABORTED': 'Envoi annulé.',
    'error.CONFLICT': 'Cette action entre en conflit avec l’état actuel.',
    'error.UNSUPPORTED_FILE': 'Format de fichier non pris en charge.',
    'error.FILE_TOO_LARGE': 'Fichier trop volumineux.',
    'error.UPLOAD_NOT_FOUND': 'Fichier introuvable. Renvoyez-le.',
    'error.RESTYLE_IN_PROGRESS': 'Ce clip est déjà en cours de ré-encodage.',
    'error.RESTYLE_UNAVAILABLE':
      'Les fichiers de découpe ont été nettoyés : le style ne peut plus être changé.',
    'error.SUBTITLES_UNAVAILABLE': 'Les sous-titres de ce clip ne sont plus disponibles.',
    'error.MODEL_UNAVAILABLE':
      'Le modèle d’IA configuré n’est plus disponible. Le serveur doit être mis à jour.',

    // --- Publication ---
    'publish.title': 'Publier',
    'publish.hint':
      'Un bloc par plateforme, dans l’ordre des champs du formulaire : ouvrez, collez, envoyez.',
    'publish.youtube': 'YouTube Shorts',
    'publish.tiktok': 'TikTok',
    'publish.open': 'Ouvrir',
    'publish.copyTitle': 'Titre',
    'publish.copyDescription': 'Description (+ hashtags)',
    'publish.copyCaption': 'Légende complète (+ hashtags)',
    'publish.markDone': 'Marquer publié',
    'publish.done': 'Publié',
    'publish.downloadAll': 'Tout télécharger (ZIP)',
    'publish.downloadAllHint':
      'Les {count} clips, plus un mémo texte avec tous les titres et descriptions.',
    'publish.progress': '{done} sur {total} publiés',
    'publish.seriesOrder': 'Mode série : publiez dans l’ordre, un épisode à la fois.',
    'publish.markedDone': 'Marqué comme publié sur {platform}.',
    'subtitles.saved': 'Sous-titres enregistrés, ré-encodage lancé.',

    // --- Outils d'un clip : style, bornes, sous-titres ---
    'tools.style': 'Style',
    'tools.bounds': 'Bornes',
    'tools.subtitles': 'Sous-titres',
    'bounds.title': 'Ajuster le début et la fin',
    'bounds.hint':
      'Chaque extrait est découpé avec une marge de sécurité : les bornes se déplacent dans cette marge sans relancer la génération.',
    'bounds.start': 'Début',
    'bounds.end': 'Fin',
    'bounds.duration': 'Durée obtenue',
    'bounds.apply': 'Appliquer les bornes',
    'bounds.none': 'Aucune marge disponible sur ce clip.',
    'subtitles.title': 'Corriger les sous-titres',
    'subtitles.hint':
      'Corrigez un nom mal transcrit, une faute, une coupure maladroite. Le clip est ré-encodé avec vos corrections, sans nouvel appel à l’IA.',
    'subtitles.save': 'Enregistrer et ré-encoder',
    'subtitles.saving': 'Enregistrement…',
    'subtitles.unavailable': 'Les sous-titres de ce clip ne sont plus modifiables.',
    'subtitles.edited': 'Sous-titres corrigés',
    'subtitles.export': 'Exporter',
    'subtitles.loading': 'Chargement des sous-titres…',
    'subtitles.lineLabel': 'Ligne de {start} à {end}',
    'job.queuePosition': 'En file d’attente : position {position}',
    'job.queueFirst': 'En file d’attente : prochain traité',

    // --- Stratégie de découpage ---
    'mode.label': 'Que faire de la vidéo',
    'mode.highlights': 'Les meilleurs moments',
    'mode.highlightsHint':
      'Des extraits indépendants, pris là où la vidéo est la plus forte. Chacun se suffit à lui-même et se publie dans n’importe quel ordre.',
    'mode.series': 'Des épisodes à la suite',
    'mode.seriesHint':
      'Une suite numérotée dans l’ordre de la vidéo. Chaque partie laisse une question ouverte et annonce la suivante, pour transformer une vue en abonnement.',

    // --- Mise en page, accroche, sous-titres traduits ---
    'options.advanced': 'Réglages avancés',
    'options.layout': 'Mise en page verticale',
    'options.layout.crop': 'Recadré',
    'options.layout.cropHint': 'Plein écran. Les bords sont coupés.',
    'options.layout.blur': 'Fond flou',
    'options.layout.blurHint': 'Image entière conservée, sur fond flouté.',
    'options.series': 'Mode série (partie 1, 2, 3…)',
    'options.seriesHint':
      'Les extraits forment une suite dans l’ordre de la vidéo. Chaque épisode annonce le suivant et invite à s’abonner pour ne pas le rater.',
    'options.hookOverlay': 'Incruster l’accroche',
    'options.hookOverlayHint':
      'Affiche la phrase d’accroche en bandeau sur les premières secondes. Le clip reste compréhensible sans le son.',
    'options.subtitleLanguage': 'Langue des sous-titres',
    'options.subtitleSource': 'Langue parlée (aucune traduction)',
    'options.subtitleLanguageHint':
      'Traduire les sous-titres demande un appel supplémentaire au fournisseur d’IA.',
    'options.tracking': 'Cadrage automatique sur le sujet',
    'options.trackingHint':
      'Le cadre suit le visage ou le point d’intérêt. Le point de focus ci-dessous ne sert qu’en cas d’échec du suivi.',
    'steps.translate': 'Traduction des sous-titres',

    // --- Source : URL ou fichier ---
    'source.url': 'URL YouTube',
    'source.file': 'Mon fichier vidéo',
    'source.fileHint':
      'Recommandé pour recycler vos propres vidéos : aucun téléchargement YouTube, aucune question de droits.',
    'source.drop': 'Déposez votre vidéo ici',
    'source.or': 'ou',
    'source.choose': 'Choisir un fichier',
    'source.formats': 'Formats acceptés : {formats}. Taille maximale : {size} Mo.',
    'source.selected': 'Fichier sélectionné',
    'source.remove': 'Retirer',
    'source.uploading': 'Envoi en cours',
    'source.tooLarge': 'Ce fichier dépasse {size} Mo.',
    'source.badFormat': 'Format non pris en charge.',
    'source.submitFile': 'Envoyer et générer',

    // --- Historique ---
    'nav.library': 'Mes générations',
    'library.title': 'Mes générations',
    'library.subtitle': 'Les générations lancées depuis ce navigateur.',
    'library.empty': 'Aucune génération pour le moment.',
    'library.emptyCta': 'Lancer une première génération',
    'library.open': 'Ouvrir',
    'library.delete': 'Supprimer',
    'library.deleteConfirm': 'Supprimer cette génération et ses clips ? Cette action est définitive.',
    'library.loadMore': 'Charger plus',
    'library.clips': '{count} clip | {count} clips',
    'library.sourceUpload': 'Fichier envoyé',
    'library.sourceYoutube': 'YouTube',
    'library.untitled': 'Sans titre',
    'library.retention':
      'Les générations et leurs fichiers sont supprimés automatiquement après {days} jours.',

    // --- Re-stylisation ---
    'restyle.open': 'Changer le style',
    'restyle.title': 'Ré-encoder ce clip',
    'restyle.hint':
      'Change les sous-titres et le cadrage sans relancer la génération. Aucun quota consommé.',
    'restyle.apply': 'Appliquer',
    'restyle.cancel': 'Annuler',
    'restyle.queued': 'Ré-encodage en cours…',
    'restyle.error': 'Le ré-encodage a échoué.',
    'restyle.unavailable':
      'Les fichiers de découpe ont été nettoyés : le style de ce clip ne peut plus être changé.',

    'steps.prepare': 'Préparation du fichier',

    'notFound.title': 'Page introuvable',
    'notFound.body': 'La page demandée n’existe pas ou a été déplacée.',
    'notFound.cta': 'Retour à l’accueil',

    'loading.job': 'Chargement du job…',
    'footer.selfHosted': 'Auto-hébergé, sans API payante.',
  },

  en: {
    'app.name': 'ytshorter',
    'app.tagline': 'One YouTube video, ready-to-post vertical clips.',
    'nav.new': 'New generation',
    'nav.language': 'Interface language',
    'nav.skipToContent': 'Skip to main content',

    'home.title': 'Turn a video into Shorts and TikToks',
    'home.subtitle':
      'Paste a YouTube URL. The best moments are found, cut to 1080x1920, subtitled, and delivered with titles and descriptions.',
    'home.urlLabel': 'YouTube video URL',
    'home.urlPlaceholder': 'https://www.youtube.com/watch?v=…',
    'home.urlHint': 'Accepted formats: youtube.com/watch, youtu.be, youtube.com/shorts.',
    'home.submit': 'Generate clips',
    'home.submitting': 'Creating job…',
    'home.options': 'Options',
    'home.optionsHint': 'These settings apply to the whole generation.',
    'home.legalTitle': 'To fill in before any public launch',
    'home.legalBody':
      '[Placeholder to complete: legal notice, terms of use and privacy policy.] This tool downloads YouTube videos, which goes against YouTube’s terms of service, and republishing someone else’s video raises copyright questions. The intended use is recycling your own content.',

    'options.language': 'Metadata language',
    'options.languageHint': 'Language of generated titles, descriptions and captions.',
    'options.clipCount': 'Number of clips',
    'options.targetDuration': 'Target clip duration',
    'options.captionStyle': 'Subtitle style',
    'options.focus': 'Horizontal focus point',
    'options.focusHint': 'Moves the crop window left or right.',
    'options.focusLeft': 'Left',
    'options.focusCenter': 'Center',
    'options.focusRight': 'Right',
    'options.seconds': 'seconds',
    'options.style.punch': 'Punch — uppercase, yellow highlight',
    'options.style.clean': 'Clean — subtle, cyan highlight',
    'options.style.boxed': 'Boxed — opaque band',
    'options.style.none': 'None — no burned-in subtitles',

    // What the machine is doing at each step: an explained wait is easier.
    'steps.desc.download': 'Fetching the source video.',
    'steps.desc.prepare': 'Reading the uploaded file and checking the audio track.',
    'steps.desc.transcribe': 'Speech recognition, with per-word timestamps.',
    'steps.desc.select': 'Reading the transcript to find the best moments.',
    'steps.desc.translate': 'Translating the subtitles of the selected excerpts.',
    'steps.desc.cut': 'Cutting the excerpts, with a margin so they can be adjusted later.',
    'steps.desc.render': 'Vertical cropping, subtitle burn-in and encoding. The longest step.',
    'steps.desc.metadata': 'Writing titles, descriptions and hashtags.',
    'steps.desc.finalize': 'Cleaning up intermediate files.',
    'job.elapsed': 'Elapsed',

    'steps.queued': 'Queued',
    'steps.download': 'Download',
    'steps.transcribe': 'Transcription',
    'steps.select': 'Moment selection',
    'steps.cut': 'Cutting',
    'steps.render': 'Cropping and subtitles',
    'steps.metadata': 'Metadata',
    'steps.finalize': 'Finalizing',
    'steps.done': 'Done',
    'steps.error': 'Error',

    'job.title': 'Processing',
    'job.subtitle': 'You can leave this page open: progress updates live.',
    'job.progress': 'Progress',
    'job.currentStep': 'Current step',
    'job.liveOff': 'Live stream interrupted',
    'job.liveOffFallback': 'Live stream interrupted: refreshing every 3 seconds.',
    'job.slowNotice': 'Transcription without a GPU is slow: expect several minutes for a long video.',
    'job.viewResults': 'View clips',
    'job.retry': 'Try again',
    'job.backHome': 'New generation',

    'results.title': 'Your clips',
    'results.count': '{count} clip ready | {count} clips ready',
    'results.clipsWord': 'clips',
    'results.empty': 'No clip for this job.',
    'results.sourceTitle': 'Source video',
    'results.download': 'Download MP4',
    'results.hook': 'Hook',
    'results.range': 'Excerpt from {start} to {end}',
    'results.score': 'Score',
    'results.ytTitle': 'YouTube Shorts title',
    'results.ytDescription': 'YouTube Shorts description',
    'results.ytHashtags': 'YouTube hashtags',
    'results.tiktokCaption': 'TikTok caption',
    'results.tiktokHashtags': 'TikTok hashtags',
    'results.copy': 'Copy',
    'results.copied': 'Copied',
    'results.copyFailed': 'Copy failed, select the text manually.',
    'results.videoUnsupported': 'Your browser cannot play this video.',
    'results.newJob': 'Generate more clips',
    'results.linkExpired': 'Download links expired. Refresh the page.',

    'error.title': 'Processing failed',
    'error.INVALID_URL': 'This URL is not a valid YouTube video.',
    'error.VIDEO_TOO_LONG': 'This video is too long to process.',
    'error.DOWNLOAD_FAILED': 'Download failed: private, geo-blocked, members-only or deleted video.',
    'error.NO_SPEECH': 'No speech detected: subtitles cannot be generated.',
    'error.TRANSCRIPTION_FAILED': 'Transcription failed. Try again in a few minutes.',
    'error.QUOTA_EXCEEDED': 'The free AI provider quota is exhausted. Try again later.',
    'error.PROVIDER_ERROR': 'The AI provider returned an unusable response.',
    'error.RATE_LIMITED': 'Too many requests. Wait a few minutes before retrying.',
    'error.VALIDATION_FAILED': 'The submitted options are invalid.',
    'error.NOT_FOUND': 'This job cannot be found.',
    'error.FORBIDDEN': 'This job does not belong to you.',
    'error.UNAUTHORIZED': 'Sign in to start a generation.',
    'error.LINK_EXPIRED': 'This link expired. Refresh the page.',
    'error.INTERNAL': 'An internal error occurred.',
    'error.NETWORK': 'Server unreachable. Check your connection.',
    'error.ABORTED': 'Upload cancelled.',
    'error.CONFLICT': 'This action conflicts with the current state.',
    'error.UNSUPPORTED_FILE': 'Unsupported file format.',
    'error.FILE_TOO_LARGE': 'File too large.',
    'error.UPLOAD_NOT_FOUND': 'File not found. Upload it again.',
    'error.RESTYLE_IN_PROGRESS': 'This clip is already being re-encoded.',
    'error.RESTYLE_UNAVAILABLE': 'The cut files were cleaned up: the style can no longer be changed.',
    'error.SUBTITLES_UNAVAILABLE': 'This clip’s subtitles are no longer available.',
    'error.MODEL_UNAVAILABLE':
      'The configured AI model is no longer available. The server needs updating.',

    // --- Publishing ---
    'publish.title': 'Publish',
    'publish.hint': 'One block per platform, in form-field order: open, paste, post.',
    'publish.youtube': 'YouTube Shorts',
    'publish.tiktok': 'TikTok',
    'publish.open': 'Open',
    'publish.copyTitle': 'Title',
    'publish.copyDescription': 'Description (+ hashtags)',
    'publish.copyCaption': 'Full caption (+ hashtags)',
    'publish.markDone': 'Mark as posted',
    'publish.done': 'Posted',
    'publish.downloadAll': 'Download all (ZIP)',
    'publish.downloadAllHint': 'All {count} clips, plus a text memo with every title and description.',
    'publish.progress': '{done} of {total} posted',
    'publish.seriesOrder': 'Series mode: post in order, one episode at a time.',
    'publish.markedDone': 'Marked as posted on {platform}.',
    'subtitles.saved': 'Subtitles saved, re-encoding started.',

    // --- Clip tools: style, bounds, subtitles ---
    'tools.style': 'Style',
    'tools.bounds': 'Bounds',
    'tools.subtitles': 'Subtitles',
    'bounds.title': 'Adjust start and end',
    'bounds.hint':
      'Every excerpt is cut with a safety margin: bounds move inside that margin without rerunning generation.',
    'bounds.start': 'Start',
    'bounds.end': 'End',
    'bounds.duration': 'Resulting length',
    'bounds.apply': 'Apply bounds',
    'bounds.none': 'No margin available on this clip.',
    'subtitles.title': 'Fix the subtitles',
    'subtitles.hint':
      'Fix a misheard name, a typo, an awkward break. The clip is re-encoded with your corrections, with no new AI call.',
    'subtitles.save': 'Save and re-encode',
    'subtitles.saving': 'Saving…',
    'subtitles.unavailable': 'This clip’s subtitles can no longer be edited.',
    'subtitles.edited': 'Subtitles edited',
    'subtitles.export': 'Export',
    'subtitles.loading': 'Loading subtitles…',
    'subtitles.lineLabel': 'Line from {start} to {end}',
    'job.queuePosition': 'Queued: position {position}',
    'job.queueFirst': 'Queued: next in line',

    // --- Cutting strategy ---
    'mode.label': 'What to do with the video',
    'mode.highlights': 'Best moments',
    'mode.highlightsHint':
      'Independent excerpts, taken where the video is strongest. Each stands alone and can be posted in any order.',
    'mode.series': 'Sequential episodes',
    'mode.seriesHint':
      'A numbered sequence in video order. Each part leaves a question open and teases the next, turning a view into a follow.',

    // --- Layout, hook, translated subtitles ---
    'options.advanced': 'Advanced settings',
    'options.layout': 'Vertical layout',
    'options.layout.crop': 'Cropped',
    'options.layout.cropHint': 'Full screen. Edges are cut off.',
    'options.layout.blur': 'Blurred background',
    'options.layout.blurHint': 'Whole image kept, over a blurred backdrop.',
    'options.series': 'Series mode (part 1, 2, 3…)',
    'options.seriesHint':
      'Clips form a sequence in video order. Each episode teases the next and invites a follow so viewers don’t miss it.',
    'options.hookOverlay': 'Burn in the hook',
    'options.hookOverlayHint':
      'Shows the hook line as a banner over the first seconds. The clip stays understandable without sound.',
    'options.subtitleLanguage': 'Subtitle language',
    'options.subtitleSource': 'Spoken language (no translation)',
    'options.subtitleLanguageHint': 'Translating subtitles requires one extra AI provider call.',
    'options.tracking': 'Automatic subject framing',
    'options.trackingHint':
      'The frame follows the face or point of interest. The focus point below is only used if tracking fails.',
    'steps.translate': 'Subtitle translation',

    // --- Source: URL or file ---
    'source.url': 'YouTube URL',
    'source.file': 'My video file',
    'source.fileHint':
      'Recommended for recycling your own videos: no YouTube download, no copyright question.',
    'source.drop': 'Drop your video here',
    'source.or': 'or',
    'source.choose': 'Choose a file',
    'source.formats': 'Accepted formats: {formats}. Maximum size: {size} MB.',
    'source.selected': 'Selected file',
    'source.remove': 'Remove',
    'source.uploading': 'Uploading',
    'source.tooLarge': 'This file exceeds {size} MB.',
    'source.badFormat': 'Unsupported format.',
    'source.submitFile': 'Upload and generate',

    // --- History ---
    'nav.library': 'My generations',
    'library.title': 'My generations',
    'library.subtitle': 'Generations started from this browser.',
    'library.empty': 'No generation yet.',
    'library.emptyCta': 'Start a first generation',
    'library.open': 'Open',
    'library.delete': 'Delete',
    'library.deleteConfirm': 'Delete this generation and its clips? This cannot be undone.',
    'library.loadMore': 'Load more',
    'library.clips': '{count} clip | {count} clips',
    'library.sourceUpload': 'Uploaded file',
    'library.sourceYoutube': 'YouTube',
    'library.untitled': 'Untitled',
    'library.retention': 'Generations and their files are deleted automatically after {days} days.',

    // --- Restyle ---
    'restyle.open': 'Change style',
    'restyle.title': 'Re-encode this clip',
    'restyle.hint': 'Change subtitles and framing without rerunning generation. No quota used.',
    'restyle.apply': 'Apply',
    'restyle.cancel': 'Cancel',
    'restyle.queued': 'Re-encoding…',
    'restyle.error': 'Re-encoding failed.',
    'restyle.unavailable':
      'The cut files were cleaned up: this clip’s style can no longer be changed.',

    'steps.prepare': 'Preparing file',

    'notFound.title': 'Page not found',
    'notFound.body': 'The requested page does not exist or has moved.',
    'notFound.cta': 'Back to home',

    'loading.job': 'Loading job…',
    'footer.selfHosted': 'Self-hosted, no paid API.',
  },
};

export const availableLocales = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
];

// Titres et descriptions de page, par route et par langue.
export const pageMeta = {
  fr: {
    home: {
      title: 'ytshorter — des Shorts et TikToks depuis une vidéo YouTube',
      description:
        'Collez une URL YouTube : les meilleurs passages deviennent des clips verticaux 1080x1920 sous-titrés, avec titres et descriptions prêts à publier.',
    },
    job: {
      title: 'Traitement en cours — ytshorter',
      description: 'Suivi en direct du découpage de votre vidéo en clips verticaux.',
    },
    results: {
      title: 'Vos clips — ytshorter',
      description: 'Clips verticaux sous-titrés, titres YouTube Shorts et légendes TikTok.',
    },
    library: {
      title: 'Mes générations — ytshorter',
      description: 'Historique des vidéos transformées en clips verticaux.',
    },
    notFound: { title: 'Page introuvable — ytshorter', description: 'Cette page n’existe pas.' },
  },
  en: {
    home: {
      title: 'ytshorter — Shorts and TikToks from a YouTube video',
      description:
        'Paste a YouTube URL: the best moments become subtitled 1080x1920 vertical clips with ready-to-post titles and descriptions.',
    },
    job: {
      title: 'Processing — ytshorter',
      description: 'Live progress of your video being cut into vertical clips.',
    },
    results: {
      title: 'Your clips — ytshorter',
      description: 'Subtitled vertical clips, YouTube Shorts titles and TikTok captions.',
    },
    library: {
      title: 'My generations — ytshorter',
      description: 'History of videos turned into vertical clips.',
    },
    notFound: { title: 'Page not found — ytshorter', description: 'This page does not exist.' },
  },
};
