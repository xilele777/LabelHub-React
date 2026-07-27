/**
 * Start a backend with an isolated SQLite database and run API E2E tests.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 3191;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const serverRoot = path.join(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'labelhub-e2e-'));
const dbPath = path.join(tempDir, 'labelhub.db');

// Windows 冷启动（better-sqlite3 原生模块加载 + 空库自动 seed）实测可超过 10s，超时给足 30s
function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    function probe() {
      const req = http.get(`${BASE_URL}/api/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
          return;
        }
        retry();
      });

      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    }

    function retry() {
      if (Date.now() >= deadline) {
        reject(new Error(`Backend did not become healthy at ${BASE_URL}`));
        return;
      }
      setTimeout(probe, 200);
    }

    probe();
  });
}

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: serverRoot,
      env,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 3000);

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    child.kill();
  });
}

async function main() {
  const env = {
    ...process.env,
    LABELHUB_DB_PATH: dbPath,
    PORT: String(PORT),
  };

  const server = spawn(process.execPath, ['index.js'], {
    cwd: serverRoot,
    env,
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  try {
    await waitForHealth();
    const resetCode = await runNode(['test/reset-db.js'], env);
    if (resetCode !== 0) {
      process.exitCode = resetCode;
      return;
    }

    const e2eCode = await runNode(['test/e2e-test.js'], {
      ...env,
      BASE_URL,
    });
    process.exitCode = e2eCode;
  } finally {
    await stopProcess(server);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
