-- v1.4 : mode série — plusieurs clips tirés d'une même vidéo, pensés comme
-- une suite (partie 1, 2, 3…) où chaque épisode appelle le suivant.
ALTER TABLE jobs
  ADD COLUMN series_mode TINYINT(1) NOT NULL DEFAULT 0 AFTER hook_overlay;
