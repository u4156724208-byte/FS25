if (process.env.FARMING_SIMULATOR_BOT_DISABLE_CERTIFICATE_VERIFICATION === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
}

const _ = require('lodash');
const convert = require('xml-js');
const fetch = require('fetch-retry')(global.fetch);

const retries = Math.max(parseInt(process.env.FARMING_SIMULATOR_BOT_FETCH_RETRIES, 10), 1) || 5;
const retryDelay = Math.max(parseInt(
  process.env.FARMING_SIMULATOR_BOT_FETCH_RETRY_DELAY_MS,
  10,
), 1) || 2000;

const getDefaultDatabase = () => (_.cloneDeep({
  server: {
    game: '',
    version: '',
    name: '',
    mapName: '',
    online: false,
    unreachable: false,
  },
  mods: {},
  slots: {
    players: {},
    numUsed: 0,
    capacity: 0,
  },
  careerSavegame: {
    money: 0,
    playTime: 0,
  },
}));

const getTimestamp = () => `<t:${Math.floor(new Date().getTime() / 1000)}>`;

const formatPlayers = (players) => {
  const formatter = new Intl.ListFormat('it', { style: 'long', type: 'conjunction' });
  return formatter.format(Object.keys(players)
    .sort((playerA, playerB) => playerA.toLowerCase().localeCompare(playerB.toLowerCase())));
};

const formatMinutes = (minutes) => {
  const remainingDays = Math.floor(minutes / 1440);
  const remainingHours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;

  let string = '';
  if (remainingDays > 0) {
    string += `${remainingDays} ${remainingDays === 1 ? 'giorno' : 'giorni'}, `;
  }
  if (remainingHours > 0) {
    string += `${remainingHours} ${remainingHours === 1 ? 'ora' : 'ore'} e `;
  }
  string += `${remainingMinutes} ${remainingMinutes === 1 ? 'minuto' : 'minuti'}`;
  return string;
};

const fetchWithRetry = (url, options) => fetch(url, {
  ...options,
  retries,
  retryDelay,
});

const xmlToJson = (xml) => convert.xml2js(xml, { compact: true, alwaysArray: false });

const getDataFromAPI = async () => {
  const serverStatsUrl = process.env.FARMING_SIMULATOR_BOT_URL_SERVER_STATS;
  const careerSavegameUrl = process.env.FARMING_SIMULATOR_BOT_URL_CAREER_SAVEGAME;

  const [statsResponse, savegameResponse] = await Promise.all([
    fetchWithRetry(serverStatsUrl),
    fetchWithRetry(careerSavegameUrl),
  ]);

  if (!statsResponse.ok) {
    throw new Error(`Failed to fetch server stats: ${statsResponse.status} ${statsResponse.statusText}`);
  }
  if (!savegameResponse.ok) {
    throw new Error(`Failed to fetch career savegame: ${savegameResponse.status} ${savegameResponse.statusText}`);
  }

  const statsText = await statsResponse.text();
  const savegameText = await savegameResponse.text();

  const statsJson = xmlToJson(statsText);
  const savegameJson = xmlToJson(savegameText);

  return {
    stats: statsJson,
    savegame: savegameJson,
  };
};

const parseData = (rawData, previousPlayers, previousServer) => {
  try {
    const stats = rawData.stats;
    const savegame = rawData.savegame;

    if (!stats || !stats.Server) {
      return null;
    }

    const serverNode = stats.Server;
    
    // Server info
    const game = serverNode._attributes?.game || serverNode.game?._text || '';
    const version = serverNode._attributes?.version || serverNode.version?._text || '';
    const serverName = serverNode._attributes?.name || serverNode.name?._text || previousServer.name || '';
    const mapName = serverNode._attributes?.mapName || serverNode.mapName?._text || serverNode.map?._text || '';

    // Slots / players
    let slotsNode = serverNode.Slots || serverNode.slots || {};
    let capacity = parseInt(slotsNode._attributes?.capacity || slotsNode.capacity?._text || 0, 10);
    let numUsed = parseInt(slotsNode._attributes?.numUsed || slotsNode.numUsed?._text || 0, 10);

    // Players list can be in different structures
    let playersRaw = slotsNode.Player || slotsNode.Players?.Player || [];
    if (!Array.isArray(playersRaw)) {
      playersRaw = playersRaw ? [playersRaw] : [];
    }

    const players = {};
    const now = new Date().getTime();

    playersRaw.forEach((p) => {
      const name = p._attributes?.name || p._text || p.name?._text || '';
      if (!name) return;
      const isAdmin = (p._attributes?.isAdmin || p.isAdmin?._text) === 'true';
      const uptime = parseInt(p._attributes?.uptime || p.uptime?._text || 0, 10);
      
      let firstSeen = now;
      if (previousPlayers && previousPlayers[name] && previousPlayers[name].firstSeen) {
        firstSeen = previousPlayers[name].firstSeen;
      }

      players[name] = {
        name,
        isAdmin,
        uptime,
        firstSeen,
      };
    });

    // Mods
    const modsNode = serverNode.Mods || serverNode.mods || {};
    let modsRaw = modsNode.Mod || modsNode.mod || [];
    if (!Array.isArray(modsRaw)) {
      modsRaw = modsRaw ? [modsRaw] : [];
    }

    const mods = {};
    modsRaw.forEach((mod) => {
      const modName = mod._attributes?.name || mod.name?._text || '';
      if (!modName) return;
      const author = mod._attributes?.author || mod.author?._text || 'Sconosciuto';
      const version = mod._attributes?.version || mod.version?._text || '';
      mods[modName] = {
        name: modName,
        author,
        version,
      };
    });

    // Career savegame
    let money = 0;
    let playTime = 0;
    try {
      const careerNode = savegame.careerSavegame || savegame.careersavegame || savegame;
      if (careerNode) {
        // Money can be in different places
        const moneyNode = careerNode.statistics?.money || careerNode.money || {};
        money = parseInt(moneyNode._text || moneyNode._attributes?.money || careerNode._attributes?.money || 0, 10);
        
        const playTimeNode = careerNode.statistics?.playTime || careerNode.playTime || {};
        playTime = parseInt(playTimeNode._text || playTimeNode._attributes?.playTime || 0, 10);
      }
    } catch (e) {
      // keep defaults
    }

    return {
      server: {
        game,
        version,
        name: serverName,
        mapName,
        online: true,
        unreachable: false,
      },
      mods,
      slots: {
        players,
        numUsed: Object.keys(players).length || numUsed,
        capacity,
      },
      careerSavegame: {
        money,
        playTime,
      },
    };
  } catch (e) {
    console.error('Error parsing data:', e);
    return null;
  }
};

const getModString = (newData, previousMods, isDlc) => {
  let string = '';
  const newMods = Object.values(newData.mods).filter(({ name: modName }) => {
    const isPdlc = modName.startsWith('pdlc_');
    return isDlc ? isPdlc : !isPdlc;
  });

  const previousModsFiltered = Object.values(previousMods).filter(({ name: modName }) => {
    const isPdlc = modName.startsWith('pdlc_');
    return isDlc ? isPdlc : !isPdlc;
  });

  const newModNames = newMods.map(m => m.name);
  const previousModNames = previousModsFiltered.map(m => m.name);

  const addedMods = newMods.filter(m => !previousModNames.includes(m.name));

  if (addedMods.length > 0) {
    const label = isDlc ? 'DLC' : 'mod';
    const plural = addedMods.length > 1 ? (isDlc ? 'nuovi DLC' : 'nuove mod') : (isDlc ? 'nuovo DLC' : 'nuova mod');
    string += `\n:star2: Il server ha **${addedMods.length}** ${plural}:\n`;
    addedMods.forEach((mod) => {
      string += `  **${mod.name} ${mod.version}** di ${mod.author}\n`;
    });
  }

  return string;
};

module.exports = {
  getDefaultDatabase,
  getTimestamp,
  formatPlayers,
  formatMinutes,
  fetchWithRetry,
  xmlToJson,
  getDataFromAPI,
  parseData,
  getModString,
};
