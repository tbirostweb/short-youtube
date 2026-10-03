-- v1.2 : mise en page verticale, accroche incrustée, sous-titres traduits.

ALTER TABLE jobs
  -- crop = recadrage 9:16 ; blur = vidéo entière sur fond flou
  ADD COLUMN layout VARCHAR(16) NOT NULL DEFAULT 'crop' AFTER caption_style,
  -- accroche affichée en bandeau sur les premières secondes du clip
  ADD COLUMN hook_overlay TINYINT(1) NOT NULL DEFAULT 0 AFTER layout,
  -- NULL ou 'source' = sous-titres dans la langue parlée
  ADD COLUMN subtitle_language VARCHAR(10) NULL AFTER language;

-- Réglages propres à un clip, quand il a été re-stylisé individuellement.
ALTER TABLE clips
  ADD COLUMN layout VARCHAR(16) NULL AFTER caption_style,
  ADD COLUMN hook_overlay TINYINT(1) NULL AFTER layout;
