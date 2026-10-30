'use strict';

/**
 * Matchmaker do Game Together.
 *
 * Regras:
 *  - A fila é separada por jogo + idioma + grupo de plataforma + modo.
 *  - Grupo de plataforma: se o jogo tem crossplay, todas as plataformas
 *    caem no mesmo grupo. Se não tem, cada plataforma é um grupo isolado
 *    (PC não encontra console, por exemplo). "crossplayGroups" permite
 *    grupos parciais (ex.: Minecraft Java só com Java, Bedrock com o resto).
 *  - Modo "duo": 2 pessoas. Fica esperando até aparecer outra pessoa com a
 *    mesma combinação; aí a sala é criada e fechada.
 *  - Modo "group": 3+. A pessoa entra numa sala aberta com a mesma
 *    combinação; se não existir, cria uma. Outras pessoas vão entrando
 *    até o limite do jogo.
 */

class Matchmaker {
  constructor(config) {
    this.config = config;
    this.games = new Map(config.games.map((g) => [g.id, g]));
    this.rooms = new Map();      // roomId -> room
    this.duoQueue = new Map();   // key -> [{ id, player }]
    this.players = new Map();    // playerId -> { id, name, gameId, lang, platform, mode, roomId, key }
    this.roomSeq = 0;
  }

  getGame(gameId) {
    return this.games.get(gameId) || null;
  }

  isValidLang(lang) {
    return this.config.languages.some((l) => l.code === lang);
  }

  platformGroup(game, platform) {
    // Jogo com crossplay total: a plataforma não importa (e nem é pedida).
    if (game.crossplay === true && !Array.isArray(game.crossplayGroups)) return 'all';
    if (!game.platforms.includes(platform)) return null;
    if (Array.isArray(game.crossplayGroups)) {
      const idx = game.crossplayGroups.findIndex((grp) => grp.includes(platform));
      return idx >= 0 ? `g${idx}` : platform;
    }
    return platform;
  }

  makeKey(gameId, lang, group, mode) {
    return `${gameId}|${lang}|${group}|${mode}`;
  }

  /**
   * Valida a requisição. Retorna { error } ou { game, group, key }.
   */
  validate(req) {
    const game = this.getGame(req.gameId);
    if (!game) return { error: 'unknown_game' };
    if (!this.isValidLang(req.lang)) return { error: 'unknown_language' };
    const group = this.platformGroup(game, req.platform);
    if (!group) return { error: 'unknown_platform' };
    if (req.mode !== 'duo' && req.mode !== 'group') return { error: 'unknown_mode' };
    if (req.mode === 'group' && game.maxPlayers < 3) return { error: 'mode_not_allowed' };
    const name = String(req.name || '').trim().slice(0, 24);
    if (!name) return { error: 'missing_name' };
    return { game, group, key: this.makeKey(game.id, req.lang, group, req.mode), name };
  }

  /**
   * Coloca o jogador para procurar partida.
   * Retorna { status: 'waiting' } ou { status: 'matched', room, joined: [ids] }.
   */
  find(playerId, req) {
    this.leave(playerId);
    const v = this.validate(req);
    if (v.error) return { error: v.error };

    const player = {
      id: playerId,
      name: v.name,
      gameId: v.game.id,
      lang: req.lang,
      platform: v.group === 'all' ? null : req.platform,
      mode: req.mode,
      key: v.key,
      roomId: null,
    };
    this.players.set(playerId, player);

    if (req.mode === 'duo') {
      const queue = this.duoQueue.get(v.key) || [];
      const partner = queue.shift();
      if (partner) {
        if (queue.length === 0) this.duoQueue.delete(v.key);
        else this.duoQueue.set(v.key, queue);
        const room = this.createRoom(v.game, player, 2);
        this.addToRoom(room, partner);
        this.addToRoom(room, player);
        return { status: 'matched', room, joined: [partner.id, player.id] };
      }
      queue.push(player);
      this.duoQueue.set(v.key, queue);
      return { status: 'waiting', key: v.key };
    }

    // group: entra em sala aberta ou cria uma
    let room = null;
    for (const r of this.rooms.values()) {
      if (r.key === v.key && r.members.size < r.max) {
        room = r;
        break;
      }
    }
    if (!room) room = this.createRoom(v.game, player, v.game.maxPlayers);
    this.addToRoom(room, player);
    return { status: 'matched', room, joined: [player.id] };
  }

  createRoom(game, player, max) {
    const id = `room-${++this.roomSeq}-${Math.random().toString(36).slice(2, 8)}`;
    const room = {
      id,
      key: player.key,
      gameId: game.id,
      gameName: game.name,
      lang: player.lang,
      mode: player.mode,
      platformGroup: this.platformGroup(game, player.platform),
      max,
      members: new Map(),
      createdAt: Date.now(),
    };
    this.rooms.set(id, room);
    return room;
  }

  addToRoom(room, player) {
    room.members.set(player.id, player);
    player.roomId = room.id;
  }

  /**
   * Tira o jogador da fila e/ou da sala.
   * Retorna { room, remaining } se ele estava numa sala; null caso contrário.
   */
  leave(playerId) {
    const player = this.players.get(playerId);
    if (!player) return null;
    this.players.delete(playerId);

    const queue = this.duoQueue.get(player.key);
    if (queue) {
      const rest = queue.filter((p) => p.id !== playerId);
      if (rest.length) this.duoQueue.set(player.key, rest);
      else this.duoQueue.delete(player.key);
    }

    if (!player.roomId) return null;
    const room = this.rooms.get(player.roomId);
    if (!room) return null;
    room.members.delete(playerId);
    if (room.members.size === 0) this.rooms.delete(room.id);
    return { room, remaining: [...room.members.keys()] };
  }

  roomOf(playerId) {
    const player = this.players.get(playerId);
    if (!player || !player.roomId) return null;
    return this.rooms.get(player.roomId) || null;
  }

  publicRoom(room) {
    return {
      id: room.id,
      gameId: room.gameId,
      gameName: room.gameName,
      lang: room.lang,
      mode: room.mode,
      max: room.max,
      members: [...room.members.values()].map((m) => ({
        id: m.id,
        name: m.name,
        platform: m.platform,
      })),
    };
  }

  stats() {
    const games = {};
    const bucket = (id) => (games[id] = games[id] || { inCall: 0, searching: 0 });
    let waiting = 0;
    for (const q of this.duoQueue.values()) {
      waiting += q.length;
      for (const p of q) bucket(p.gameId).searching += 1;
    }
    let inRooms = 0;
    for (const r of this.rooms.values()) {
      inRooms += r.members.size;
      bucket(r.gameId).inCall += r.members.size;
    }
    return {
      searching: waiting,
      inCall: inRooms,
      rooms: this.rooms.size,
      games,
    };
  }
}

module.exports = { Matchmaker };
