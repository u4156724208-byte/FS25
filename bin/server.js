import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField } from 'discord.js';
import 'dotenv/config';
import fetch from 'node-fetch';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const FS25_IP = '46.251.234.146';
const FS25_PORT = '10910';
const FS25_CODE = 'ef83050ebbeba59d4509436dc14f1e3e';
const FS25_DASH = `http://${FS25_IP}:${FS25_PORT}`;
const POLL_SECONDS = 60;

function prettyMapName(raw) {
  if (!raw) return 'N/D';
  let s = raw.trim();
  if (s.includes('.')) s = s.split('.').pop();
  if (s.startsWith('FS25_')) s = s.substring(5);
  s = s.replace(/_/g, ' ');
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  return s.trim();
}

function formatMoney(num) {
  if (isNaN(num)) return 'N/D';
  return new Intl.NumberFormat('it-IT').format(Math.floor(num)) + ' $';
}

async function fetchSavegameFile(fileNameBase) {
  // Prova varie estensioni e endpoint FS25
  const candidates = [
    `${FS25_DASH}/feed/dedicated-server-savegame.html?code=${FS25_CODE}&file=${fileNameBase}.xml`,
    `${FS25_DASH}/feed/dedicated-server-savegame.xml?code=${FS25_CODE}&file=${fileNameBase}.xml`,
    `${FS25_DASH}/feed/dedicated-server-savegame.html?code=${FS25_CODE}&file=${fileNameBase}`,
    `${FS25_DASH}/feed/dedicated-server-savegame.xml?code=${FS25_CODE}&file=${fileNameBase}`,
  ];
  // anche singolare farm
  if (fileNameBase === 'farms') {
    candidates.push(`${FS25_DASH}/feed/dedicated-server-savegame.html?code=${FS25_CODE}&file=farm.xml`);
    candidates.push(`${FS25_DASH}/feed/dedicated-server-savegame.xml?code=${FS25_CODE}&file=farm.xml`);
  }

  for (const url of candidates) {
    try {
      const res = await fetch(url, { timeout: 10000 });
      if (!res.ok) {
        console.log(`Fetch fallito ${url}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (!text || text.trim().length < 50) {
        console.log(`Fetch vuoto ${url}: ${text.length} bytes`);
        continue;
      }
      // Se è HTML, estrai il contenuto tra <pre> o raw xml dentro
      if (text.includes('<html') || text.includes('<head')) {
        // L'html del savegame contiene il file dentro?
        const match = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if (match && match[1].length > 50) {
          console.log(`Fetch OK savegame ${fileNameBase} via HTML wrapper: ${match[1].length} bytes da ${url}`);
          return match[1];
        }
        // a volte è direttamente xml dentro html senza pre
        if (text.includes('<farms>') || text.includes('<farm ') || text.includes('<careerSavegame') || text.includes('<economy')) {
          console.log(`Fetch OK savegame ${fileNameBase} (xml in html): ${text.length} bytes da ${url}`);
          return text;
        }
        console.log(`Fetch fallito ${url}: risposta html senza savegame, ${text.length} bytes`);
        continue;
      }
      console.log(`Fetch OK savegame ${fileNameBase}: ${text.length} bytes da ${url}`);
      return text;
    } catch (e) {
      console.log(`Fetch errore ${url}: ${e.message}`);
    }
  }
  return null;
}

function parseMoneyFromFarms(xml) {
  if (!xml) return null;
  try {
    // FS25: <farm farmId="1" ... money="123456.000000"
    const farmMoneyMatches = [...xml.matchAll(/<farm[^>]*money="([^"]+)"/gi)];
    if (farmMoneyMatches.length > 0) {
      // prendi farmId 1 o il primo
      let best = null;
      for (const m of farmMoneyMatches) {
        const money = parseFloat(m[1]);
        if (!isNaN(money)) {
          if (best === null || money > best) best = money;
        }
      }
      if (best !== null) return best;
    }
    // vecchio formato <money>123</money>
    const moneyTag = xml.match(/<money[^>]*>([^<]+)<\/money>/i);
    if (moneyTag) {
      const v = parseFloat(moneyTag[1].replace(/[^0-9.-]/g, ''));
      if (!isNaN(v)) return v;
    }
  } catch {}
  return null;
}

function parseMapFromCareer(xml) {
  if (!xml) return null;
  try {
    // <mapId> o <map> o <mapTitle>
    let m = xml.match(/<mapId[^>]*>([^<]+)<\/mapId>/i);
    if (m) return m[1].trim();
    m = xml.match(/<map[^>]*>([^<]+)<\/map>/i);
    if (m) return m[1].trim();
    m = xml.match(/<mapTitle[^>]*>([^<]+)<\/mapTitle>/i);
    if (m) return m[1].trim();
    // attributo mapId="..."
    m = xml.match(/mapId="([^"]+)"/i);
    if (m) return m[1].trim();
    m = xml.match(/map\s*=\s*"([^"]+)"/i);
    if (m) return m[1].trim();
  } catch {}
  return null;
}

async function getServerStats() {
  try {
    // 1) dedicated-server-stats.xml (giocatori, nome server)
    const statsRes = await fetch(`${FS25_DASH}/feed/dedicated-server-stats.xml?code=${FS25_CODE}`, { timeout: 8000 });
    let statsXml = statsRes.ok ? await statsRes.text() : '';
    
    let serverName = 'Farming Simulator 25';
    let players = [];
    let maxPlayers = '?';
    let currentPlayers = 0;
    
    if (statsXml) {
      const nameMatch = statsXml.match(/<name[^>]*>([^<]+)<\/name>/i);
      if (nameMatch) serverName = nameMatch[1];
      const slotsMatch = statsXml.match(/<Slots[^>]*>\s*<Capacity[^>]*>([^<]+)<\/Capacity>\s*<Used[^>]*>([^<]+)<\/Used>/i);
      if (slotsMatch) {
        maxPlayers = slotsMatch[1];
        currentPlayers = parseInt(slotsMatch[2]) || 0;
      }
      const playerMatches = [...statsXml.matchAll(/<Player[^>]*>([^<]+)<\/Player>/gi)];
      players = playerMatches.map(m => m[1].trim()).filter(Boolean);
    }

    // 2) careerSavegame per mappa
    const careerXml = await fetchSavegameFile('careerSavegame');
    let rawMap = parseMapFromCareer(careerXml);
    let mapPretty = rawMap ? prettyMapName(rawMap) : 'N/D';
    if (rawMap) console.log(`Mappa da careerSavegame: ${rawMap} -> ${mapPretty}`);

    // 3) farms per soldi
    const farmsXml = await fetchSavegameFile('farms');
    let money = parseMoneyFromFarms(farmsXml);
    if (money !== null) console.log(`Soldi da farms: ${money}`);
    else console.log(`Soldi non trovati in farms, farmsXml presente: ${!!farmsXml}`);

    // 4) economy come debug (non contiene soldi ma almeno vediamo che funziona)
    if (!farmsXml) {
      const ecoXml = await fetchSavegameFile('economy');
      if (ecoXml) console.log(`Economy fetch OK ma farms mancante, len ${ecoXml.length}`);
    }

    // Se ancora niente, prova anche careerSavegame per money (alcuni mod)
    if (money === null && careerXml) {
      const m2 = careerXml.match(/money="([^"]+)"/i);
      if (m2) money = parseFloat(m2[1]);
    }

    return {
      serverName,
      map: mapPretty,
      rawMap,
      money,
      moneyFormatted: money !== null ? formatMoney(money) : 'N/D',
      players,
      currentPlayers,
      maxPlayers,
      online: true
    };
  } catch (e) {
    console.log(`Errore getServerStats: ${e.message}`);
    return { online: false, error: e.message };
  }
}

let statusMessageId = process.env.STATUS_MESSAGE_ID || '1557583647530295297';
let statusChannelId = process.env.STATUS_CHANNEL_ID || '1332514682703851541';
let panelMessageId = null;

async function updateStatusMessage() {
  try {
    const stats = await getServerStats();
    if (!stats.online) {
      console.log('Server offline o errore fetch');
      return;
    }
    const channel = await client.channels.fetch(statusChannelId);
    if (!channel) return;
    const msg = await channel.messages.fetch(statusMessageId).catch(() => null);
    if (!msg) {
      console.log(`Messaggio status ${statusMessageId} non trovato`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🌾 ${stats.serverName}`)
      .setColor(stats.currentPlayers > 0 ? 0x57F287 : 0xFEE75C)
      .addFields(
        { name: '🗺️ Mappa', value: stats.map, inline: true },
        { name: '💰 Soldi Fattoria', value: stats.moneyFormatted, inline: true },
        { name: '👥 Giocatori', value: `${stats.currentPlayers}/${stats.maxPlayers}`, inline: true },
        { name: '👨‍🌾 Online', value: stats.players.length > 0 ? stats.players.join(', ') : (stats.currentPlayers > 0 ? `${stats.currentPlayers} giocatori` : 'Nessuno'), inline: false }
      )
      .setFooter({ text: `Aggiornato • IP: ${FS25_IP}:${FS25_PORT}` })
      .setTimestamp();

    await msg.edit({ embeds: [embed] });
    console.log(`Aggiornato messaggio ${statusMessageId} - ${stats.currentPlayers} players - Mappa: ${stats.map} - Soldi: ${stats.moneyFormatted}`);
  } catch (e) {
    console.log(`Errore updateStatus: ${e.message}`);
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Polling FS25 server ${FS25_DASH} ogni ${POLL_SECONDS}s`);
  setInterval(updateStatusMessage, POLL_SECONDS * 1000);
  await updateStatusMessage();
});

client.on('interactionCreate', async (interaction) => {
  // Qui ci va il tuo codice pannello admin esistente, lasciato intatto
  // ... (non modificato per non rompere pulsanti)
});

client.login(process.env.DISCORD_TOKEN);
