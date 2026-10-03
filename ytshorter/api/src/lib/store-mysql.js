import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const here = path.dirname(fileURLToPath(import.meta.url));

// Accès MySQL. Toutes les requêtes sont paramétrées : aucune concaténation SQL.
export function createMysqlStore(opts) {
  const pool = mysql.createPool({
    host: opts.host,
    port: opts.port,
    user: opts.user,
    password: opts.password,
    database: opts.database,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
  });

  async function query(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  return {
    pool,

    async ping() {
      const rows = await query('SELECT 1 AS ok');
      return rows.length === 1;
    },

    // Migrations : fichiers .sql du dossier migrations, exécutés dans l'ordre,
    // une seule fois. Le suivi est en base (table schema_migrations), ce qui
    // permet des migrations non idempotentes comme les ALTER TABLE.
    async migrate(logger) {
      const dir = path.join(here, '..', '..', 'migrations');
      const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
      const conn = await mysql.createConnection({
        host: opts.host,
        port: opts.port,
        user: opts.user,
        password: opts.password,
        database: opts.database,
        multipleStatements: true,
      });
      try {
        await conn.query(
          `CREATE TABLE IF NOT EXISTS schema_migrations (
             filename   VARCHAR(190) NOT NULL,
             applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
             PRIMARY KEY (filename)
           ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        );
        const [applied] = await conn.query('SELECT filename FROM schema_migrations');
        const done = new Set(applied.map((row) => row.filename));

        for (const file of files) {
          if (done.has(file)) continue;
          const sql = await fs.readFile(path.join(dir, file), 'utf8');
          await conn.query(sql);
          await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
          logger?.info({ file }, 'migration appliquée');
        }
      } finally {
        await conn.end();
      }
    },

    async createJob(job) {
      const rows = await query(
        `INSERT INTO jobs
           (user_id, owner_key, source_kind, source_name, youtube_url, youtube_video_id,
            language, subtitle_language, clip_count, target_duration, caption_style,
            focus_x, layout, hook_overlay, series_mode, status, current_step, progress)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', 0)`,
        [
          job.userId ?? null,
          job.ownerKey,
          job.sourceKind ?? 'youtube',
          job.sourceName ?? null,
          job.youtubeUrl ?? null,
          job.youtubeVideoId ?? null,
          job.language,
          job.subtitleLanguage ?? 'source',
          job.clipCount,
          job.targetDuration,
          job.captionStyle,
          job.focusX,
          job.layout ?? 'crop',
          job.hookOverlay ? 1 : 0,
          job.seriesMode ? 1 : 0,
        ],
      );
      return String(rows.insertId);
    },

    /** Historique : jobs d'un propriétaire, du plus récent au plus ancien. */
    async listJobs(ownerKey, { limit = 20, offset = 0 } = {}) {
      // Bornes appliquées en nombre entier : jamais de valeur brute dans le SQL.
      const safeLimit = Math.max(1, Math.min(50, Number.parseInt(limit, 10) || 20));
      const safeOffset = Math.max(0, Math.min(10000, Number.parseInt(offset, 10) || 0));
      const rows = await query(
        `SELECT j.*, (SELECT COUNT(*) FROM clips c WHERE c.job_id = j.id) AS clips_count
           FROM jobs j
          WHERE j.owner_key = ?
          ORDER BY j.created_at DESC, j.id DESC
          LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        [ownerKey],
      );
      return rows.map((row) => ({ ...normalizeJob(row), clipsCount: Number(row.clips_count) }));
    },

    async countJobs(ownerKey) {
      const rows = await query('SELECT COUNT(*) AS total FROM jobs WHERE owner_key = ?', [ownerKey]);
      return Number(rows[0]?.total ?? 0);
    },

    /** Supprime un job ; les clips partent en cascade. */
    async deleteJob(id) {
      await query('DELETE FROM jobs WHERE id = ?', [id]);
    },

    // --- Fichiers envoyés par l'utilisateur ---
    async createUpload(upload) {
      const rows = await query(
        `INSERT INTO uploads (owner_key, token, file_path, original_name, size_bytes)
         VALUES (?, ?, ?, ?, ?)`,
        [upload.ownerKey, upload.token, upload.filePath, upload.originalName, upload.sizeBytes],
      );
      return String(rows.insertId);
    },

    async getUploadByToken(token) {
      const rows = await query('SELECT * FROM uploads WHERE token = ? LIMIT 1', [token]);
      if (!rows[0]) return null;
      return {
        id: String(rows[0].id),
        ownerKey: rows[0].owner_key,
        token: rows[0].token,
        filePath: rows[0].file_path,
        originalName: rows[0].original_name,
        sizeBytes: Number(rows[0].size_bytes),
        consumedAt: rows[0].consumed_at,
      };
    },

    async consumeUpload(id) {
      await query('UPDATE uploads SET consumed_at = NOW() WHERE id = ?', [id]);
    },

    /** Marque (ou démarque) un clip comme publié sur une plateforme. */
    async setClipPublished(clipId, platform, published) {
      // Le nom de colonne vient d'une liste fermée, jamais de l'entrée client.
      const column = platform === 'youtube' ? 'published_youtube' : 'published_tiktok';
      await query(
        `UPDATE clips SET ${column} = ${published ? 'NOW()' : 'NULL'} WHERE id = ?`,
        [clipId],
      );
    },

    // --- Re-stylisation d'un clip ---
    async setClipRestyleStatus(clipId, status) {
      await query('UPDATE clips SET restyle_status = ? WHERE id = ?', [status, clipId]);
    },

    async getJob(id) {
      const rows = await query('SELECT * FROM jobs WHERE id = ? LIMIT 1', [id]);
      return rows[0] ? normalizeJob(rows[0]) : null;
    },

    async getClips(jobId) {
      const rows = await query('SELECT * FROM clips WHERE job_id = ? ORDER BY idx ASC', [jobId]);
      return rows.map(normalizeClip);
    },

    async getClipWithOwner(id) {
      const rows = await query(
        `SELECT c.*, j.owner_key, j.user_id
           FROM clips c JOIN jobs j ON j.id = c.job_id
          WHERE c.id = ? LIMIT 1`,
        [id],
      );
      if (!rows[0]) return null;
      const clip = normalizeClip(rows[0]);
      clip.ownerKey = rows[0].owner_key;
      clip.userId = rows[0].user_id === null ? null : String(rows[0].user_id);
      return clip;
    },

    async createUser({ email, passwordHash }) {
      const rows = await query('INSERT INTO users (email, password_hash) VALUES (?, ?)', [
        email,
        passwordHash,
      ]);
      return String(rows.insertId);
    },

    async getUserByEmail(email) {
      const rows = await query('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
      return rows[0] ? { id: String(rows[0].id), email: rows[0].email, passwordHash: rows[0].password_hash } : null;
    },

    async getUserById(id) {
      const rows = await query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
      return rows[0] ? { id: String(rows[0].id), email: rows[0].email } : null;
    },

    async close() {
      await pool.end();
    },
  };
}

function parseJsonColumn(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeJob(row) {
  return {
    id: String(row.id),
    userId: row.user_id === null ? null : String(row.user_id),
    ownerKey: row.owner_key,
    sourceKind: row.source_kind ?? 'youtube',
    sourceName: row.source_name ?? null,
    youtubeUrl: row.youtube_url,
    youtubeVideoId: row.youtube_video_id,
    language: row.language,
    clipCount: row.clip_count,
    targetDuration: row.target_duration,
    captionStyle: row.caption_style,
    focusX: row.focus_x,
    layout: row.layout ?? 'crop',
    hookOverlay: Boolean(row.hook_overlay),
    seriesMode: Boolean(row.series_mode),
    subtitleLanguage: row.subtitle_language ?? 'source',
    status: row.status,
    currentStep: row.current_step,
    progress: row.progress,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    sourceTitle: row.source_title,
    sourceDuration: row.source_duration,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeClip(row) {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    idx: row.idx,
    startSeconds: row.start_seconds,
    endSeconds: row.end_seconds,
    padStart: Number(row.pad_start ?? 0),
    padEnd: Number(row.pad_end ?? 0),
    score: row.score,
    hook: row.hook,
    filePath: row.file_path,
    duration: row.duration,
    captionStyle: row.caption_style ?? null,
    focusX: row.focus_x === null || row.focus_x === undefined ? null : Number(row.focus_x),
    layout: row.layout ?? null,
    hookOverlay: row.hook_overlay === null || row.hook_overlay === undefined ? null : Boolean(row.hook_overlay),
    restyleStatus: row.restyle_status ?? 'idle',
    subtitlesEdited: Boolean(row.subtitles_edited),
    publishedYoutube: row.published_youtube ?? null,
    publishedTiktok: row.published_tiktok ?? null,
    ytTitle: row.yt_title,
    ytDescription: row.yt_description,
    ytHashtags: parseJsonColumn(row.yt_hashtags),
    tiktokCaption: row.tiktok_caption,
    tiktokHashtags: parseJsonColumn(row.tiktok_hashtags),
  };
}
