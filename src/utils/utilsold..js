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

const utils = {
  getDefaultDatabase: () => (_.cloneDeep({
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
  })),

  getTimestamp: () => `<t:${Math.floor(new Date().getTime() / 1000)}>`,

  formatPlayers: (players) => {
    const formatter = new Intl.ListFormat('it', { style: 'long', type: 'conjunction' });
    return formatter.format(Object.keys(players)
      .sort((playerA, playerB) => playerA.toLowerCase().localeCompare(playerB.toLowerCase())));
  },

  formatMinutes: (minutes) => {
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
  },

  formatMoney: (money) => {
    return new Intl.NumberFormat('it-IT').format(money);
  },

  fetchWithRetry: (url, options) => fetch(url, {
    ...options,
    retries,
    retryDelay,
  }),

  xmlToJson: (xml) => convert.xml2js(xml, { compact: true, alwaysArray: false }),
};

module.exports = utils;
