import fs from 'node:fs';
import ini from 'ini';

function requireValue(parsed, section, key) {
  const sec = parsed[section];
  if (!sec || !(key in sec)) {
    throw new Error(`missing key "${key}" in section [${section}]`);
  }
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

function parseSettings(parsed) {
  const host = requireValue(parsed, 'server', 'host').trim();
  const port = parsePort(requireValue(parsed, 'server', 'port'));
  return { host, port };
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
