import { createAppState, createApp, worker } from './src/ygoPicProxy.js';
import { loadSettings } from './src/config.js';

async function main() {
  const settings = loadSettings('config.ini');
  const state = await createAppState();

  worker(state).catch((err) => {
    console.error('worker crashed:', err);
  });

  const app = createApp(state);
  const httpServer = app.listen(settings.port, settings.host, () => {
    console.log(`ygo-pic-proxy listening on ${settings.host}:${settings.port}`);
  });
  httpServer.on('error', (err) => {
    console.error(`failed to listen on ${settings.host}:${settings.port}: ${err.message}`);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
