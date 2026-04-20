require('dotenv').config();

let puter = null;
let initError = null;

try {
  const { init } = require('@heyputer/puter.js/src/init.cjs');
  if (!process.env.PUTER_AUTH_TOKEN) {
    initError = new Error('PUTER_AUTH_TOKEN is missing. Run `npm run puter:token` in /server, then add the token to server/.env');
  } else {
    puter = init(process.env.PUTER_AUTH_TOKEN);
  }
} catch (err) {
  initError = err;
}

function getPuter() {
  if (!puter) throw initError || new Error('Puter is not initialized');
  return puter;
}

function isPuterReady() {
  return !!puter;
}

function getPuterInitError() {
  return initError;
}

module.exports = { getPuter, isPuterReady, getPuterInitError };
