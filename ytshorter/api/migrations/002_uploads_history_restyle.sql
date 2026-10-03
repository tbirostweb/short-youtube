-- v1.1 : ingestion par fichier, historique, re-stylisation d'un clip.

-- La source d'un job n'est plus forcément YouTube.
ALTER TABLE jobs
  MODIFY COLUMN youtube_url VARCHAR(500) NULL,
  MODIFY COLUMN youtube_video_id VARCHAR(20) NULL,
  ADD COLUMN source_kind ENUM('youtube','upload') NOT NULL DEFAULT 'youtube' AFTER owner_key,
  ADD COLUMN source_name VARCHAR(255) NULL AFTER source_title;

-- Index de l'historique : les jobs d'un propriétaire, du plus récent au plus ancien.
CREATE INDEX idx_jobs_owner_created ON jobs (owner_key, created_at);

-- Fichiers envoyés par l'utilisateur, en attente d'être consommés par un job.
CREATE TABLE IF NOT EXISTS uploads (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_key     VARCHAR(64) NOT NULL,
  -- Identifiant public opaque : impossible à deviner, contrairement à un entier.
  token         CHAR(32) NOT NULL,
  file_path     VARCHAR(500) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  size_bytes    BIGINT UNSIGNED NOT NULL,
  consumed_at   DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_uploads_token (token),
  KEY idx_uploads_owner (owner_key),
  KEY idx_uploads_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Re-stylisation : un clip peut être ré-encodé seul, avec un autre style de
-- sous-titres ou un autre point de focus, sans relancer tout le pipeline.
ALTER TABLE clips
  ADD COLUMN caption_style VARCHAR(32) NULL AFTER duration,
  ADD COLUMN focus_x FLOAT NULL AFTER caption_style,
  ADD COLUMN restyle_status ENUM('idle','queued','processing','error') NOT NULL DEFAULT 'idle' AFTER focus_x,
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
