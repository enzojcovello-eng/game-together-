'use strict';

/**
 * Checagem de fotos de perfil no próprio servidor, sem serviço externo.
 * Usa o modelo NSFWJS (MobileNetV2Mid) com TensorFlow.js em CPU. O modelo é
 * carregado na primeira foto (uns 20 s) e fica em memória; cada análise leva
 * cerca de 2 s. Se o modelo não puder carregar, o upload é recusado: só as
 * capas da galeria ficam disponíveis.
 */

const Jimp = require('jimp');

const SIZE = 256;            // tamanho final salvo
const MODEL_SIZE = 224;      // entrada do modelo
const LIMITS = { porn: 0.4, hentai: 0.4, sexy: 0.75 };

let modelPromise = null;
function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = require('@tensorflow/tfjs');
      const nsfwjs = require('nsfwjs');
      tf.enableProdMode();
      const model = await nsfwjs.load('MobileNetV2Mid');
      return { tf, model };
    })().catch((err) => { modelPromise = null; throw err; });
  }
  return modelPromise;
}

/** Começa a carregar o modelo em segundo plano (chamado ao subir o servidor). */
function warmUp() {
  loadModel().then(() => console.log('Moderação de fotos pronta.')).catch((err) => console.warn('Moderação de fotos indisponível:', err.message));
}

/**
 * Recebe os bytes da imagem. Devolve { ok: true, jpeg } com a foto pronta
 * (quadrada, 256px, JPEG) ou { ok: false, error, scores }.
 */
async function processAvatar(buffer) {
  let img;
  try { img = await Jimp.read(buffer); } catch (_) { return { ok: false, error: 'bad_image' }; }
  if (img.bitmap.width < 32 || img.bitmap.height < 32) return { ok: false, error: 'bad_image' };

  let tf; let model;
  try { ({ tf, model } = await loadModel()); } catch (_) { return { ok: false, error: 'moderation_unavailable' }; }

  const probe = img.clone().cover(MODEL_SIZE, MODEL_SIZE);
  const { data, width, height } = probe.bitmap;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) { rgb[j] = data[i]; rgb[j + 1] = data[i + 1]; rgb[j + 2] = data[i + 2]; }
  const tensor = tf.tensor3d(rgb, [height, width, 3], 'int32');
  let preds;
  try { preds = await model.classify(tensor); } finally { tensor.dispose(); }
  const scores = Object.fromEntries(preds.map((p) => [p.className.toLowerCase(), p.probability]));
  if (scores.porn >= LIMITS.porn || scores.hentai >= LIMITS.hentai || scores.sexy >= LIMITS.sexy) {
    return { ok: false, error: 'nsfw', scores };
  }
  const jpeg = await img.cover(SIZE, SIZE).quality(82).getBufferAsync(Jimp.MIME_JPEG);
  return { ok: true, jpeg, scores };
}

module.exports = { processAvatar, warmUp, LIMITS };
