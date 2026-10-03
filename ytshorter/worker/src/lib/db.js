import mysql from 'mysql2/promise';

// Accès MySQL du worker. Requêtes paramétrées uniquement.
export function createDb(opts) {
  const pool = mysql.createPool({
    host: opts.host,
    port: opts.port,
    user: opts.user,
    password: opts.password,
    database: opts.database,
    waitForConnections: true,
    connectionLimit: 4,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
  });

  const query = async (sql, params = []) => {
    const [rows] = await pool.execute(sql, params);
    return rows;
  };

  return {
    pool,
    async ping() {
      await query('SELECT 1');
      return true;
    },
    async getJob(id) {
      const rows = await query('SELECT * FROM jobs WHERE id = ? LIMIT 1', [id]);
      return rows[0] ?? null;
    },
    async updateProgress(jobId, { status, currentStep, progress }) {
      await query(
        'UPDATE jobs SET status = ?, current_step = ?, progress = ? WHERE id = ?',
        [status, currentStep, Math.max(0, Math.min(100, Math.round(progress))), jobId],
      );
    },
    async setSourceInfo(jobId, { title, duration }) {
      await query('UPDATE jobs SET source_title = ?, source_duration = ? WHERE id = ?', [
        title ? String(title).slice(0, 500) : null,
        duration ?? null,
        jobId,
      ]);
    },
    async setError(jobId, { code, message, step }) {
      await query(
        `UPDATE jobs
            SET status = 'error', error_code = ?, error_message = ?, current_step = ?
          WHERE id = ?`,
        [code, String(message).slice(0, 1000), step ?? 'error', jobId],
      );
    },
    async setDone(jobId) {
      await query(
        `UPDATE jobs SET status = 'done', current_step = 'done', progress = 100,
                error_code = NULL, error_message = NULL
          WHERE id = ?`,
        [jobId],
      );
    },
    async deleteClips(jobId) {
      await query('DELETE FROM clips WHERE job_id = ?', [jobId]);
    },
    async insertClip(clip) {
      const rows = await query(
        `INSERT INTO clips
           (job_id, idx, start_seconds, end_seconds, pad_start, pad_end, score, hook,
            file_path, duration, yt_title, yt_description, yt_hashtags,
            tiktok_caption, tiktok_hashtags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          clip.jobId,
          clip.idx,
          clip.startSeconds,
          clip.endSeconds,
          clip.padStart ?? 0,
          clip.padEnd ?? 0,
          clip.score,
          clip.hook ? String(clip.hook).slice(0, 500) : null,
          clip.filePath,
          clip.duration,
          clip.ytTitle ? String(clip.ytTitle).slice(0, 255) : null,
          clip.ytDescription ?? null,
          JSON.stringify(clip.ytHashtags ?? []),
          clip.tiktokCaption ? String(clip.tiktokCaption).slice(0, 500) : null,
          JSON.stringify(clip.tiktokHashtags ?? []),
        ],
      );
      return String(rows.insertId);
    },
    // --- Re-stylisation d'un clip ---
    async getClip(id) {
      const rows = await query('SELECT * FROM clips WHERE id = ? LIMIT 1', [id]);
      return rows[0] ?? null;
    },
    async setClipRestyleStatus(id, status) {
      await query('UPDATE clips SET restyle_status = ? WHERE id = ?', [status, id]);
    },
    async finishRestyle(id, payload) {
      const {
        captionStyle,
        focusX,
        layout,
        hookOverlay,
        duration,
        startSeconds,
        endSeconds,
        padStart,
        padEnd,
        subtitlesEdited,
      } = payload;
      await query(
        `UPDATE clips
            SET caption_style = ?, focus_x = ?, layout = ?, hook_overlay = ?,
                duration = ?, start_seconds = ?, end_seconds = ?,
                pad_start = ?, pad_end = ?, subtitles_edited = ?,
                restyle_status = 'idle'
          WHERE id = ?`,
        [
          captionStyle,
          focusX,
          layout ?? null,
          hookOverlay ? 1 : 0,
          duration,
          startSeconds,
          endSeconds,
          Math.max(0, padStart ?? 0),
          Math.max(0, padEnd ?? 0),
          subtitlesEdited ? 1 : 0,
          id,
        ],
      );
    },

    // --- Rétention ---
    async listExpiredJobs(days) {
      const rows = await query(
        `SELECT id FROM jobs
          WHERE created_at < (NOW() - INTERVAL ? DAY)
            AND status IN ('done','error')`,
        [days],
      );
      return rows.map((row) => String(row.id));
    },
    async deleteJob(id) {
      await query('DELETE FROM jobs WHERE id = ?', [id]);
    },
    async jobExists(id) {
      const rows = await query('SELECT id FROM jobs WHERE id = ? LIMIT 1', [id]);
      return rows.length > 0;
    },
    async listStaleUploads(hours) {
      const rows = await query(
        `SELECT id, file_path FROM uploads
          WHERE consumed_at IS NULL AND created_at < (NOW() - INTERVAL ? HOUR)`,
        [hours],
      );
      return rows.map((row) => ({ id: String(row.id), filePath: row.file_path }));
    },
    async deleteConsumedUploads(hours) {
      await query(
        'DELETE FROM uploads WHERE consumed_at IS NOT NULL AND consumed_at < (NOW() - INTERVAL ? HOUR)',
        [hours],
      );
    },
    async deleteUpload(id) {
      await query('DELETE FROM uploads WHERE id = ?', [id]);
    },

    async close() {
      await pool.end();
    },
  };
}
