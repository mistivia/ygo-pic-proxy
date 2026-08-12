import fs from 'node:fs';
import ini from 'ini';

const LOG_LEVELS = ['error', 'warn', 'info', 'debug'];
const DEFAULT_LOG_LEVEL = 'info';

function requireValue(parsed, section, key) {
  const sec = parsed[section];
  if (!sec || !(key in sec)) {
    throw new Error(`missing key "${key}" in section [${section}]`);
  }
  return sec[key];
}

function optionalValue(parsed, section, key) {
  const sec = parsed[section];
  if (!sec || !(key in sec)) return undefined;
  return sec[key];
}

function parsePort(raw) {
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`invalid port: ${raw}`);
  }
  const n = Number.parseInt(trimmed, 10);
  if (n <= 0 || n > 65535) {
    throw new Error(`invalid port: ${raw}`);
  }
  return n;
}

function parseLogLevel(raw) {
  if (raw === undefined) return DEFAULT_LOG_LEVEL;
  const trimmed = raw.trim();
  if (!LOG_LEVELS.includes(trimmed)) {
    throw new Error(`invalid log_level: ${raw} (must be one of ${LOG_LEVELS.join(', ')})`);
  }
  return trimmed;
}

function parseSettings(parsed) {
  const host = requireValue(parsed, 'server', 'host').trim();
  const port = parsePort(requireValue(parsed, 'server', 'port'));
  const logLevel = parseLogLevel(optionalValue(parsed, 'server', 'log_level'));
  return { host, port, logLevel };
}

function loadSettings(configPath) {
  let text;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    throw new Error(`Failed to read ${configPath}: ${err.message}`);
  }

  const parsed = ini.parse(text);
  try {
    return parseSettings(parsed);
  } catch (err) {
    throw new Error(`Invalid config ${configPath}: ${err.message}`);
  }
}

export { loadSettings };
