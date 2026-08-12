import { initApp, createApp, worker } from './src/ygoPicProxy.js';
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

  const app = await initApp({ logLevel: settings.logLevel });

  worker(app);
  const expressApp = createApp(app);
  const httpServer = expressApp.listen(settings.port, settings.host, () => {
    app.logger.info(`ygo-pic-proxy listening on ${settings.host}:${settings.port}`);
  });
  httpServer.on('error', (err) => {
    app.logger.error(`failed to listen on ${settings.host}:${settings.port}: ${err.message}`);
    process.exit(1);
  });
}

main();