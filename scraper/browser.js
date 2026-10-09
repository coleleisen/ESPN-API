const fs = require('fs');
const puppeteer = require('puppeteer');

async function launchBrowser({ userDataDir } = {}) {
  const installedBrowser = process.platform === 'win32' && [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].find(file => fs.existsSync(file));
  return puppeteer.launch({
    headless: true,
    userDataDir,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || installedBrowser || undefined,
    defaultViewport: { width: 1440, height: 1000 }
  });
}

module.exports = { launchBrowser };
