import { initApp, createApp, worker } from './src/ygoPicProxy.js';
import { loadSettings } from './src/config.js';

async function main() {
  const settings = loadSettings('config.ini');
  const app = await initApp({ logLevel: settings.logLevel });

  worker(app).catch((err) => {
    app.logger.error('worker crashed:', err);
  });

  const expressApp = createApp(app);
  const httpServer = expressApp.listen(settings.port, settings.host, () => {
    app.logger.info(`ygo-pic-proxy listening on ${settings.host}:${settings.port}`);
  });
  httpServer.on('error', (err) => {
    app.logger.error(`failed to listen on ${settings.host}:${settings.port}: ${err.message}`);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
