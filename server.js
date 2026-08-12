import { makeAppRt, makeApp, worker } from './src/ygoPicProxy.js';
import { loadSettings } from './src/config.js';
import { Left } from './src/utils.js';

async function main() {
  const settingsResult = loadSettings('config.ini');
  if (settingsResult.type === Left) {
    console.error(settingsResult.value);
    process.exit(1);
    return;
  }
  const settings = settingsResult.value;

  const appRt = await makeAppRt({ logLevel: settings.logLevel });

  worker(appRt).catch((err) => {
    appRt.logger.error('worker crashed:', err);
    process.exit(1);
  });

  const app = makeApp(appRt);
  const httpServer = app.listen(settings.port, settings.host, () => {
    appRt.logger.info(`ygo-pic-proxy listening on ${settings.host}:${settings.port}`);
  });
  httpServer.on('error', (err) => {
    appRt.logger.error(`failed to listen on ${settings.host}:${settings.port}: ${err.message}`);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});