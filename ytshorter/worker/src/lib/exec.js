import { spawn } from 'node:child_process';

const MAX_CAPTURE = 200_000; // caractères conservés par flux

/**
 * Exécute une commande externe sans passer par un shell : les arguments sont
 * transmis tels quels, aucune interpolation, donc aucune injection possible.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{cwd?: string, timeoutMs?: number, onStderrLine?: (line: string) => void,
 *   onStdoutLine?: (line: string) => void, env?: object}} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function run(command, args, options = {}) {
  const { cwd, timeoutMs = 0, onStderrLine, onStdoutLine, env } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stderrTail = '';
    let stdoutTail = '';
    let timedOut = false;

    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_CAPTURE) stdout += chunk;
      if (onStdoutLine) {
        stdoutTail += chunk;
        const lines = stdoutTail.split(/\r?\n|\r/);
        stdoutTail = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) onStdoutLine(line);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_CAPTURE) stderr += chunk;
      if (onStderrLine) {
        stderrTail += chunk;
        const lines = stderrTail.split(/\r?\n|\r/);
        stderrTail = lines.pop() ?? '';
        for (const line of lines) if (line.trim()) onStderrLine(line);
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`Commande introuvable ou non exécutable : ${command} (${err.message})`));
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Délai dépassé (${timeoutMs} ms) pour : ${command} ${args.join(' ')}`));
        return;
      }
      if (code !== 0) {
        const tail = stderr.split('\n').filter(Boolean).slice(-12).join('\n');
        const err = new Error(`${command} a terminé avec le code ${code}\n${tail}`);
        err.exitCode = code;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ code, stdout, stderr });
    });
  });
}

/** Vérifie la présence d'un binaire dans le PATH. */
export async function commandExists(command, versionArgs = ['--version']) {
  try {
    await run(command, versionArgs, { timeoutMs: 15000 });
    return true;
  } catch {
    return false;
  }
}
