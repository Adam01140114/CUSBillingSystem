const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let installInFlight = null;

function loadPlaywrightChromium() {
  try {
    const playwright = require('playwright');
    return playwright.chromium || null;
  } catch (e) {
    return null;
  }
}

function chromiumExecutablePath() {
  const chromium = loadPlaywrightChromium();
  if (!chromium || typeof chromium.executablePath !== 'function') return '';
  try {
    return chromium.executablePath();
  } catch (e) {
    return '';
  }
}

function isChromiumInstalled() {
  const executablePath = chromiumExecutablePath();
  return !!(executablePath && fs.existsSync(executablePath));
}

function runPlaywrightInstall(repoRoot) {
  const playwrightCli = path.join(repoRoot, 'node_modules', 'playwright', 'cli.js');
  if (!fs.existsSync(playwrightCli)) {
    return {
      ok: false,
      error: 'Playwright package is not installed. Run npm install in the project folder.'
    };
  }

  const result = spawnSync(process.execPath, [playwrightCli, 'install', 'chromium'], {
    cwd: repoRoot,
    stdio: 'pipe',
    env: process.env,
    windowsHide: true
  });

  if (result.status !== 0) {
    const stderr = result.stderr ? String(result.stderr) : '';
    const stdout = result.stdout ? String(result.stdout) : '';
    const detail = (stderr || stdout || 'Unknown install error').trim();
    return {
      ok: false,
      error:
        'Could not download Playwright Chromium. Run manually: npx playwright install chromium\n' + detail
    };
  }

  if (!isChromiumInstalled()) {
    return {
      ok: false,
      error:
        'Playwright install finished but Chromium is still missing. Run: npx playwright install chromium'
    };
  }

  return { ok: true, installed: true };
}

function getPlaywrightStatus(repoRoot) {
  const playwrightInstalled = !!loadPlaywrightChromium();
  const chromiumInstalled = isChromiumInstalled();
  return {
    playwrightInstalled: playwrightInstalled,
    chromiumInstalled: chromiumInstalled,
    ready: playwrightInstalled && chromiumInstalled,
    executablePath: chromiumExecutablePath()
  };
}

async function ensurePlaywrightBrowsers(repoRoot, options) {
  options = options || {};
  const status = getPlaywrightStatus(repoRoot);
  if (status.ready) {
    return { ok: true, status: status, installed: false };
  }

  if (!status.playwrightInstalled) {
    return {
      ok: false,
      status: status,
      error: 'Playwright is not installed. Run npm install in the project folder.'
    };
  }

  if (options.checkOnly) {
    return {
      ok: false,
      status: status,
      error:
        'Playwright Chromium is not installed. The server will download it automatically on the first test run, or run: npx playwright install chromium'
    };
  }

  if (!installInFlight) {
    installInFlight = Promise.resolve()
      .then(function () {
        return runPlaywrightInstall(repoRoot);
      })
      .finally(function () {
        installInFlight = null;
      });
  }

  const installResult = await installInFlight;
  const nextStatus = getPlaywrightStatus(repoRoot);
  if (!installResult.ok) {
    return Object.assign({}, installResult, { status: nextStatus });
  }
  return { ok: true, status: nextStatus, installed: true };
}

module.exports = {
  chromiumExecutablePath,
  isChromiumInstalled,
  getPlaywrightStatus,
  ensurePlaywrightBrowsers,
  runPlaywrightInstall
};

if (require.main === module) {
  const repoRoot = path.join(__dirname, '..');
  const args = process.argv.slice(2);
  const forceInstall = args.indexOf('--install') !== -1;
  const installIfMissing = args.indexOf('--install-if-missing') !== -1 || forceInstall;

  (async function main() {
    const status = getPlaywrightStatus(repoRoot);
    if (status.ready) {
      if (!args.includes('--quiet')) {
        console.log('[playwright] Chromium ready:', status.executablePath);
      }
      process.exit(0);
    }
    if (!installIfMissing) {
      console.error('[playwright] Chromium missing:', status.executablePath || '(unknown path)');
      process.exit(1);
    }
    if (!args.includes('--quiet')) {
      console.log('[playwright] Downloading Chromium (first-time setup)…');
    }
    const result = await ensurePlaywrightBrowsers(repoRoot);
    if (!result.ok) {
      console.error('[playwright]', result.error || 'Install failed');
      process.exit(1);
    }
    if (!args.includes('--quiet')) {
      console.log('[playwright] Chromium ready:', result.status.executablePath);
    }
    process.exit(0);
  })().catch(function (err) {
    console.error('[playwright]', err && err.message ? err.message : String(err));
    process.exit(1);
  });
}
