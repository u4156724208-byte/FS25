#! /usr/bin/env node

const _ = require('lodash');
const merge = require('deepmerge');
const fs = require('fs');
const {
  Client, GatewayIntentBits, PermissionsBitField, ChannelType,
} = require('discord.js');
const { onExit } = require('signal-exit');
require('dotenv-flow').config({
  silent: true,
});

const {
  getDefaultDatabase,
  formatMinutes,
  formatPlayers,
  getTimestamp,
  getDataFromAPI,
  parseData,
  getModString,
} = require('../src/utils/utils');
const { getNextPurge, willPurge, purgeOldMessages } = require('../src/utils/purge');

const dbPath = process.env.FARMING_SIMULATOR_BOT_DB_PATH;
const pollIntervalMillis = Math.max(
  parseInt(process.env.FARMING_SIMULATOR_BOT_POLL_INTERVAL_MINUTES, 10) || 1,
  1,
) * 60000;

let intervalTimer = null;
let db = getDefaultDatabase();
let nextPurge = 0;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

const getUpdateString = (
  newData,
  previousServer,
  previousMods,
  previousPlayers,
  previousCareerSavegame,
) => {
  if (!newData) {
    return null;
  }

  let string = '';

  const previousDlcCount = Object.values(previousMods).filter(({ name: modName }) => modName.startsWith('pdlc_')).length;
  const previousModCount = Object.values(previousMods).filter(({ name: modName }) => !modName.startsWith('pdlc_')).length;

  const dlcCount = Object.values(newData.mods).filter(({ name: modName }) => modName.startsWith('pdlc_')).length;
  const modCount = Object.values(newData.mods).filter(({ name: modName }) => !modName.startsWith('pdlc_')).length;

  const {
    game, version, name: serverName, mapName, online,
  } = newData.server;
  
  if (online && !previousServer.online) {
    string += ':tractor: Il server è **tornato ONLINE**!\n';
  }

  const dlcString = getModString(newData, previousMods, true);
  const modString = getModString(newData, previousMods, false);

  if ((!!game && game !== previousServer.game)
    || (!!version && version !== previousServer.version)
    || (!!serverName && serverName !== previousServer.name)
    || (!!mapName && mapName !== previousServer.mapName)
    || !!dlcString
    || !!modString) {
    console.log('Previous:', previousServer.game, previousServer.version, previousServer.name, previousServer.mapName, previousDlcCount, previousModCount);
    console.log('Current:', game, version, serverName, mapName, dlcCount, modCount);

    string += `:tractor: Il server **${serverName}** è stato aggiornato: ${game} (${version}), Mappa: ${mapName}, DLC: ${dlcCount}, Mod: ${modCount}\n`;
    string += dlcString;
    string += modString;
  }

  if (process.env.FARMING_SIMULATOR_BOT_DISABLE_SAVEGAME_MESSAGES !== 'true') {
    const { money, playTime } = newData.careerSavegame;
    if (previousCareerSavegame.money !== money) {
      let directionEmoji = '';
      let moneyDifferenceSign = '';
      const moneyDifferenceAbsolute = Math.abs(money - previousCareerSavegame.money);

      if (money > previousCareerSavegame.money) {
        directionEmoji = ':arrow_up_small:';
        moneyDifferenceSign = '+';
      }
      if (money < previousCareerSavegame.money) {
        directionEmoji = ':arrow_down_small:';
        moneyDifferenceSign = '-';
      }
      string += `:moneybag: Soldi in cassa: ${directionEmoji} **${money.toLocaleString('it-IT')}** (${moneyDifferenceSign}${moneyDifferenceAbsolute.toLocaleString('it-IT')}).\n`;
    }
    if (previousCareerSavegame.playTime !== playTime) {
      string += `:watch: Tempo di gioco: **${formatMinutes(playTime)}**.\n`;
    }
  }

  const { numUsed, capacity, players } = newData.slots;
  if (!_.isEqual(previousPlayers, players)) {
    const newPlayersArray = [];
    Object.values(players)
      .sort((playerA, playerB) => playerA.name.toLowerCase()
        .localeCompare(playerB.name.toLowerCase()))
      .forEach((player) => {
        if (!Object.prototype.hasOwnProperty.call(previousPlayers, player.name)) {
          newPlayersArray.push(player);
        }
      });
    const newPlayers = newPlayersArray
      .reduce((obj, player) => Object.assign(obj, { [player.name]: player }), {});

    const leftPlayersArray = [];
    Object.values(previousPlayers)
      .sort((playerA, playerB) => playerA.name.toLowerCase()
        .localeCompare(playerB.name.toLowerCase()))
      .forEach((player) => {
        if (!Object.prototype.hasOwnProperty.call(players, player.name)) {
          leftPlayersArray.push(player);
        }
      });
    const leftPlayers = leftPlayersArray
      .reduce((obj, player) => Object.assign(obj, { [player.name]: player }), {});

    if (Object.keys(newPlayers).length > 0 || Object.keys(leftPlayers).length > 0) {
      string += `:farmer: **${numUsed}** di ${capacity} giocatori online${(numUsed > 0 ? `: **${formatPlayers(players)}**` : '')} (${getTimestamp()}).\n`;
    }

    if (Object.keys(newPlayers).length > 0) {
      console.log(newPlayers);
      string += `    :arrow_right: **${formatPlayers(newPlayers)}** è entrato nel server.\n`;
    }

    Object.values(leftPlayers).forEach(({ name: playerName, firstSeen }) => {
      const playTimeInMinutes = Math.round((new Date().getTime() - firstSeen) / 60000);
      string += `    :arrow_left: **${playerName}** è uscito dal server dopo aver giocato per **${formatMinutes(playTimeInMinutes)}**.\n`;
    });
  }

  return string.trim() || null;
};

const sendMessage = (message) => {
  if (message) {
    client.channels.cache.filter((channel) => (
      !process.env.FARMING_SIMULATOR_BOT_DISCORD_SERVER_NAME
        || channel.guild.name === process.env.FARMING_SIMULATOR_BOT_DISCORD_SERVER_NAME
    )
      && (!process.env.FARMING_SIMULATOR_BOT_DISCORD_CHANNEL_NAME
          || channel.name === process.env.FARMING_SIMULATOR_BOT_DISCORD_CHANNEL_NAME)
      && channel.type === ChannelType.GuildText
      && channel.guild.members.me.permissionsIn(channel)
        .has(PermissionsBitField.Flags.ViewChannel)
      && channel.guild.members.me.permissionsIn(channel)
        .has(PermissionsBitField.Flags.SendMessages)
      && channel.send).forEach((channel) => {
      console.log(`Sending message to: ${channel.guild.name}: ${channel.name}`);
      channel.send(message)
        .catch((error) => {
          console.error(error);
        });
    });
  }
};

const attemptPurge = () => {
  const now = new Date().getTime();
  if (willPurge() && now >= nextPurge) {
    nextPurge = getNextPurge();
    console.log('Looking for messages to purge...');
    try {
      purgeOldMessages(client);
    } catch (e) {
      console.error(e);
    }
    console.log(`Next purge will be ${new Date(nextPurge)}`);
  }
};

const update = () => {
  console.log('Updating...');
  getDataFromAPI()
    .then((rawData) => {
      try {
        const previouslyUnreachable = db.server.unreachable;
        const previousServer = db.server;
        const previousMods = db.mods;
        const previousPlayers = db.slots.players;
        const previousCareerSavegame = db.careerSavegame;

        const data = parseData(rawData, previousPlayers, previousServer);

        if (previouslyUnreachable) {
          if (process.env.FARMING_SIMULATOR_BOT_DISABLE_UNREACHABLE_FOUND_MESSAGES !== 'true') {
            sendMessage(':thumbsup: Il server è stato **ritrovato**.');
          }
          db.server.unreachable = false;
        }

        if (data) {
          const updateString = getUpdateString(
            data,
            previousServer,
            previousMods,
            previousPlayers,
            previousCareerSavegame,
          );
          sendMessage(updateString);
          db = data;
        } else {
          if (previousServer.online) {
            sendMessage(':tools: Il server è andato **OFFLINE**.');
          }

          db.server.online = false;
          db.server.unreachable = false;
          db.slots = {
            players: {},
            numUsed: 0,
            capacity: 0,
          };
        }

        if (data?.server?.online) {
          client.user.setActivity(`online: ${data.slots.numUsed}/${data.slots.capacity}`);
        } else {
          client.user.setActivity('offline');
        }

        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
      } catch (e) {
        console.error(e);
      }
    })
    .catch((e) => {
      console.error(e);
      client.user.setActivity('sconosciuto');
      if (!db.server.unreachable) {
        if (process.env.FARMING_SIMULATOR_BOT_DISABLE_UNREACHABLE_FOUND_MESSAGES !== 'true') {
          sendMessage(':man_shrugging: Il server è **irraggiungibile**.');
        }
        db.server.unreachable = true;
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
      }
    });

  attemptPurge();
};

client.on('ready', () => {
  if (willPurge()) {
    if (process.env.FARMING_SIMULATOR_BOT_PURGE_DISCORD_CHANNEL_ON_STARTUP === 'true') {
      attemptPurge();
    } else {
      nextPurge = getNextPurge();
      console.log(`First purge will be ${new Date(nextPurge)}`);
    }
  }

  if (intervalTimer) {
    clearInterval(intervalTimer);
  }

  update();
  intervalTimer = setInterval(() => {
    update();
  }, pollIntervalMillis);
});

const initialise = () => {
  console.log(`Poll interval: ${pollIntervalMillis} milliseconds`);
  if (fs.existsSync(dbPath)) {
    try {
      db = merge(db, JSON.parse(fs.readFileSync(dbPath, 'utf8')));
      console.log(`Found: ${dbPath}`);
    } catch (e) {
      console.error(`Unable to read: ${dbPath}`);
    }
  } else {
    console.log(`New DB written: ${dbPath}`);
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
  }

  client.login(process.env.FARMING_SIMULATOR_BOT_DISCORD_TOKEN);
};

process.on('beforeExit', (code) => {
  console.log('Process beforeExit event with code: ', code);
});

onExit(() => {
  console.log('Logging out');
  client.destroy();
});

initialise();
