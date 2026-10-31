'use strict';
// Roda a checagem de fotos numa thread separada: o servidor continua
// atendendo todo mundo enquanto o modelo carrega e analisa.
const { parentPort } = require('worker_threads');
const { processAvatar } = require('./moderation');

parentPort.on('message', async ({ id, buffer }) => {
  try {
    const r = await processAvatar(Buffer.from(buffer));
    parentPort.postMessage({ id, result: { ok: r.ok, error: r.error, scores: r.scores, jpeg: r.jpeg ? r.jpeg.toString('base64') : null } });
  } catch (err) {
    parentPort.postMessage({ id, result: { ok: false, error: 'moderation_unavailable', detail: err.message } });
  }
});
