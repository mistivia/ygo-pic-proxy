import fs from 'node:fs';
import ini from 'ini';
import { Left, Right } from './utils.js';

const LOG_LEVELS = ['error', 'warn', 'info', 'debug'];
const DEFAULT_LOG_LEVEL = 'info';

function requireValue(parsed, section, key) {
  const sec = parsed[section];
  if (!sec || !(key in sec)) {
    return Left(`missing key "${key}" in section [${section}]`);
  }
  return Right(sec[key]);
}

function optionalValue(parsed, section, key) {
  const sec = parsed[section];
  if (!sec || !(key in sec)) return Right(undefined);
  return Right(sec[key]);
}

function parsePort(raw) {
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    return Left(`invalid port: ${raw}`);
  }
  const n = Number.parseInt(trimmed, 10);
  if (n <= 0 || n > 65535) {
    return Left(`invalid port: ${raw}`);
  }
  return Right(n);
}

function parseLogLevel(raw) {
  if (raw === undefined) return Right(DEFAULT_LOG_LEVEL);
  const trimmed = raw.trim();
  if (!LOG_LEVELS.includes(trimmed)) {
    return Left(`invalid log_level: ${raw} (must be one of ${LOG_LEVELS.join(', ')})`);
  }
  return Right(trimmed);
}

function parseSettings(parsed) {
  const hostResult = requireValue(parsed, 'server', 'host');
  if (hostResult.type === Left) return hostResult;

  const portRawResult = requireValue(parsed, 'server', 'port');
  if (portRawResult.type === Left) return portRawResult;
  const portResult = parsePort(portRawResult.value);
  if (portResult.type === Left) return portResult;

  const logLevelRawResult = optionalValue(parsed, 'server', 'log_level');
  if (logLevelRawResult.type === Left) return logLevelRawResult;
  const logLevelResult = parseLogLevel(logLevelRawResult.value);
  if (logLevelResult.type === Left) return logLevelResult;

  return Right({
    host: hostResult.value.trim(),
    port: portResult.value,
    logLevel: logLevelResult.value,
  });
}

function loadSettings(configPath) {
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch (e) {
    return Left(`Failed to read ${configPath}: ${e.message}`);
  }

  const parsed = ini.parse(text);
  const settingsResult = parseSettings(parsed);
  if (settingsResult.type === Left) {
    return Left(`Invalid config ${configPath}: ${settingsResult.value}`);
  }
  return settingsResult;
}

export { loadSettings };
