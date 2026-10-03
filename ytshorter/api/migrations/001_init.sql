-- Schéma initial. Exécuté automatiquement au démarrage de l'api (idempotent).

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jobs (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id          BIGINT UNSIGNED NULL,
  -- Propriétaire effectif du job. Vaut "user:<id>" quand l'authentification est
  -- active, "anon:<sessionId>" en mode mono-utilisateur. Permet d'appliquer le
  -- contrôle d'appartenance même sans comptes.
  owner_key        VARCHAR(64) NOT NULL,
  youtube_url      VARCHAR(500) NOT NULL,
  youtube_video_id VARCHAR(20) NOT NULL,
  language         VARCHAR(10) NOT NULL,
  clip_count       INT NOT NULL,
  target_duration  INT NOT NULL,
  caption_style    VARCHAR(32) NOT NULL,
  focus_x          FLOAT NOT NULL DEFAULT 0.5,
  status           ENUM('queued','processing','done','error') NOT NULL DEFAULT 'queued',
  current_step     VARCHAR(32) NOT NULL DEFAULT 'queued',
  progress         INT NOT NULL DEFAULT 0,
  error_code       VARCHAR(32) NULL,
  error_message    TEXT NULL,
  source_title     VARCHAR(500) NULL,
  source_duration  FLOAT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_jobs_user_status (user_id, status),
  KEY idx_jobs_owner (owner_key),
  KEY idx_jobs_video (youtube_video_id),
  CONSTRAINT fk_jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clips (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id          BIGINT UNSIGNED NOT NULL,
  idx             INT NOT NULL,
  start_seconds   FLOAT NOT NULL,
  end_seconds     FLOAT NOT NULL,
  score           INT NOT NULL DEFAULT 0,
  hook            VARCHAR(500) NULL,
  file_path       VARCHAR(500) NOT NULL,
  duration        FLOAT NOT NULL,
  yt_title        VARCHAR(255) NULL,
  yt_description  TEXT NULL,
  yt_hashtags     JSON NULL,
  tiktok_caption  VARCHAR(500) NULL,
  tiktok_hashtags JSON NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_clips_job (job_id),
  CONSTRAINT fk_clips_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
