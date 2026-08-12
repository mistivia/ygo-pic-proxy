const LEVEL_ORDER = { error: 0, warn: 1, info: 2, debug: 3 };

function createLogger(levelName) {
  const threshold = LEVEL_ORDER[levelName] ?? LEVEL_ORDER.info;

  function write(name, args) {
    if (LEVEL_ORDER[name] > threshold) return;
    const prefix = `[${name.toUpperCase()}]`;
    if (LEVEL_ORDER[name] <= LEVEL_ORDER.warn) {
      console.error(prefix, ...args);
    } else {
      console.log(prefix, ...args);
    }
  }

  let self = {
    error: function (...args) {
      write('error', args);
    },
    warn: function (...args) {
      write('warn', args);
    },
    info: function (...args) {
      write('info', args);
    },
    debug: function (...args) {
      write('debug', args);
    },
  };
  return self;
}

export { createLogger };
