require('dotenv').config();

let puterPromise = null;
let initError = null;

async function loadPuter() {
  if (puterPromise) return puterPromise;

  puterPromise = (async () => {
    if (!process.env.PUTER_AUTH_TOKEN) {
      throw new Error('PUTER_AUTH_TOKEN is missing. Run `npm run puter:token` in /server, then add the token to server/.env');
    }

    const mod = await import('@heyputer/puter.js/src/init.js');
    return mod.init(process.env.PUTER_AUTH_TOKEN);
  })();

  try {
    return await puterPromise;
  } catch (err) {
    initError = err;
    puterPromise = null;
    throw err;
  }
}

async function getPuter() {
  return loadPuter();
}

function isPuterReady() {
  return !!process.env.PUTER_AUTH_TOKEN;
}

function getPuterInitError() {
  return initError;
}

module.exports = { getPuter, isPuterReady, getPuterInitError };
