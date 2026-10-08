import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

const FS25_IP = '46.251.234.146';
const FS25_PORT = '10910';
const FS25_CODE = process.env.FS_CODE || process.env.FARMING_SIMULATOR_BOT_CODE || 'ef83050ebbeba59d4509436dc14f1e3e';
const FS25_DASH = `http://${FS25_IP}:${FS25_PORT}`;
const POLL_SECONDS = 60;

// Supporta SIA i tuoi vecchi nomi FARMING_SIMULATOR_BOT_* SIA i nuovi
const BOT_TOKEN = process.env.FARMING_SIMULATOR_BOT_TOKEN || process.env.FARMING_SIMULATOR_BO4 || process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
const STATUS_CHANNEL_ID = process.env.FARMING_SIMULATOR_BOT_CHANNEL_ID || process.env.FARMING_SIMULATOR_BO1 || process.env.STATUS_CHANNEL_ID || '1332514682703851541';
const STATUS_MESSAGE_ID = process.env.FARMING_SIMULATOR_BOT_MESSAGE_ID || process.env.FARMING_SIMULATOR_BOT_STATUS_MESSAGE_ID || process.env.STATUS_MESSAGE_ID || '1557583647530295297';

console.log(`Env check: TOKEN presente=${!!BOT_TOKEN} len=${BOT_TOKEN?.length || 0} CHANNEL=${STATUS_CHANNEL_ID} MESSAGE=${STATUS_MESSAGE_ID} FS_CODE=${FS25_CODE}`);

function prettyMapName(raw) {
  if (!raw) return 'N/D';
  let s = raw.trim();
  if (s.includes('.')) s = s.split('.').pop();
  if (s.startsWith('FS25_')) s = s.substring(5);
  s = s.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return s.trim();
}
function formatMoney(num) {
  if (num === null || isNaN(num)) return 'N/D';
  return new Intl.NumberFormat('it-IT').format(Math.floor(num)) + ' $';
}

async function fetchSavegameFile(fileNameBase) {
  const candidates = [
    `${FS25_DASH}/feed/dedicated-server-savegame.html?code=${FS25_CODE}&file=${fileNameBase}.xml`,
    `${FS25_DASH}/feed/dedicated-server-savegame.xml?code=${FS25_CODE}&file=${fileNameBase}.xml`,
    `${FS25_DASH}/feed/dedicated-server-savegame.html?code=${FS25_CODE}&file=${fileNameBase}`,
    `${FS25_DASH}/feed/dedicated-server-savegame.xml?code=${FS25_CODE}&file=${fileNameBase}`,
  ];
  if (fileNameBase === 'farms') {
    candidates.push(`${FS25_DASH}/feed/dedicated-server-savegame.html?code=${FS25_CODE}&file=farm.xml`);
    candidates.push(`${FS25_DASH}/feed/dedicated-server-savegame.xml?code=${FS25_CODE}&file=farm.xml`);
  }
  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) { console.log(`Fetch fallito ${url}: HTTP ${res.status}`); continue; }
      const text = await res.text();
      if (!text || text.trim().length < 50) { console.log(`Fetch vuoto ${url}: ${text.length} bytes`); continue; }
      if (text.includes('<html') || text.includes('<head')) {
        const m = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if (m && m[1].length > 50) { console.log(`Fetch OK savegame ${fileNameBase} via HTML wrapper: ${m[1].length} bytes da ${url}`); return m[1]; }
        if (text.includes('<farms>') || text.includes('<farm ') || text.includes('<careerSavegame') || text.includes('<economy')) {
          console.log(`Fetch OK savegame ${fileNameBase} (xml in html): ${text.length} bytes da ${url}`); return text;
        }
        console.log(`Fetch fallito ${url}: risposta html senza savegame, ${text.length} bytes`); continue;
      }
      console.log(`Fetch OK savegame ${fileNameBase}: ${text.length} bytes da ${url}`);
      return text;
    } catch (e) { console.log(`Fetch errore ${url}: ${e.message}`); }
  }
  return null;
}
function parseMoneyFromFarms(xml) {
  if (!xml) return null;
  try {
    const farmMoneyMatches = [...xml.matchAll(/<farm[^>]*money="([^"]+)"/gi)];
    if (farmMoneyMatches.length > 0) {
      let best = null;
      for (const m of farmMoneyMatches) {
        const money = parseFloat(m[1]); if (!isNaN(money)) { if (best === null || money > best) best = money; }
      }
      if (best !== null) return best;
    }
    const moneyTag = xml.match(/<money[^>]*>([^<]+)<\/money>/i);
    if (moneyTag) { const v = parseFloat(moneyTag[1].replace(/[^0-9.-]/g, '')); if (!isNaN(v)) return v; }
  } catch {}
  return null;
}
function parseMapFromCareer(xml) {
  if (!xml) return null;
  try {
    let m = xml.match(/<mapId[^>]*>([^<]+)<\/mapId>/i); if (m) return m[1].trim();
    m = xml.match(/<mapTitle[^>]*>([^<]+)<\/mapTitle>/i); if (m) return m[1].trim();
    m = xml.match(/<map[^>]*>([^<]+)<\/map>/i); if (m) return m[1].trim();
    m = xml.match(/mapId="([^"]+)"/i); if (m) return m[1].trim();
  } catch {}
  return null;
}
async function getServerStats() {
  try {
    const statsRes = await fetch(`${FS25_DASH}/feed/dedicated-server-stats.xml?code=${FS25_CODE}`);
    let statsXml = statsRes.ok ? await statsRes.text() : '';
    let serverName = 'Farming Simulator 25';
    let players = []; let maxPlayers = '?'; let currentPlayers = 0;
    if (statsXml) {
      const nameMatch = statsXml.match(/<name[^>]*>([^<]+)<\/name>/i); if (nameMatch) serverName = nameMatch[1];
      const slotsMatch = statsXml.match(/<Slots[^>]*>\s*<Capacity[^>]*>([^<]+)<\/Capacity>\s*<Used[^>]*>([^<]+)<\/Used>/i);
      if (slotsMatch) { maxPlayers = slotsMatch[1]; currentPlayers = parseInt(slotsMatch[2]) || 0; }
      const playerMatches = [...statsXml.matchAll(/<Player[^>]*>([^<]+)<\/Player>/gi)];
      players = playerMatches.map(m => m[1].trim()).filter(Boolean);
    }
    const careerXml = await fetchSavegameFile('careerSavegame');
    let rawMap = parseMapFromCareer(careerXml);
    let mapPretty = rawMap ? prettyMapName(rawMap) : 'N/D';
    if (rawMap) console.log(`Mappa da careerSavegame: ${rawMap} -> ${mapPretty}`);
    const farmsXml = await fetchSavegameFile('farms');
    let money = parseMoneyFromFarms(farmsXml);
    if (money !== null) console.log(`Soldi da farms: ${money}`); else console.log(`Soldi non trovati in farms, farmsXml presente: ${!!farmsXml}`);
    if (money === null && careerXml) { const m2 = careerXml.match(/money="([^"]+)"/i); if (m2) money = parseFloat(m2[1]); }
    return { serverName, map: mapPretty, rawMap, money, moneyFormatted: money !== null ? formatMoney(money) : 'N/D', players, currentPlayers, maxPlayers, online: true };
  } catch (e) { console.log(`Errore getServerStats: ${e.message}`); return { online: false, error: e.message }; }
}

async function updateStatusMessage() {
  try {
    const stats = await getServerStats();
    if (!stats.online) { console.log('Server offline o errore fetch'); return; }
    const channel = await client.channels.fetch(STATUS_CHANNEL_ID); if (!channel) { console.log(`Canale ${STATUS_CHANNEL_ID} non trovato`); return; }
    const msg = await channel.messages.fetch(STATUS_MESSAGE_ID).catch(() => null);
    if (!msg) { console.log(`Messaggio status ${STATUS_MESSAGE_ID} non trovato`); return; }
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
    console.log(`Aggiornato messaggio ${STATUS_MESSAGE_ID} - ${stats.currentPlayers} players - Mappa: ${stats.map} - Soldi: ${stats.moneyFormatted}`);
  } catch (e) { console.log(`Errore updateStatus: ${e.message}`); }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Polling FS25 server ${FS25_DASH} ogni ${POLL_SECONDS}s`);
  setInterval(updateStatusMessage, POLL_SECONDS * 1000);
  await updateStatusMessage();
});

if (!BOT_TOKEN) {
  console.error('ERRORE: BOT_TOKEN mancante! Controlla FARMING_SIMULATOR_BOT_TOKEN in Environment');
  process.exit(1);
}
client.login(BOT_TOKEN);
