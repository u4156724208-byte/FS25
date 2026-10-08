const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const dbPath = process.env.FARMING_SIMULATOR_BOT_DATABASE_PATH || '/tmp/database.json';
const pollIntervalMillis = parseInt(process.env.FARMING_SIMULATOR_BOT_POLL_INTERVAL || '60000', 10);
const discordToken = process.env.FARMING_SIMULATOR_BOT_DISCORD_TOKEN || process.env.FARMING_SIMULATOR_BOT_TOKEN;
const channelId = process.env.FARMING_SIMULATOR_BOT_CHANNEL_ID || process.env.DISCORD_CHANNEL_ID;

const FS_HOST = process.env.FS_HOST || '46.251.234.146';
const FS_PORT = process.env.FS_PORT || '10910';
const FS_GAME_PORT = process.env.FS_GAME_PORT || '10900';
let FS_CODE = process.env.FS_CODE || '';
// supporta anche le variabili vecchie con URL completo
const FEED_URL_ENV = process.env.FARMING_SIMULATOR_BOT_DSS_URL || process.env.FARMING_SIMULATOR_BOT_FEED_URL || process.env.FARMING_SIMULATOR_BOT_FEED_DSS || process.env.FARMING_SIMULATOR_BOT_FEED_DSS_URL || process.env.FEED_DSS_URL || '';

// Se FS_CODE contiene &file= o è un URL intero, estrai solo il code
if (FS_CODE.includes('code=')) {
  const m = FS_CODE.match(/code=([a-f0-9]+)/i);
  if (m) FS_CODE = m[1];
}
if (FS_CODE.includes('&file=')) {
  FS_CODE = FS_CODE.split('&file=')[0];
}

let db = { servers: [] };
function merge(t,s){ return Object.assign(t,s); }

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

let intervalTimer;
let lastMessageId = null;

async function fetchText(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'FS25-Bot' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const txt = await res.text();
    if (txt.length < 20) throw new Error('risposta vuota');
    return txt;
  } catch(e) {
    console.log(`Fetch fallito ${url}: ${e.message}`);
    return null;
  }
}

async function fetchSavegameFile(fileName) {
  const candidates = [
    `http://${FS_HOST}:${FS_PORT}/feed/dedicated-server-savegame.html?code=${FS_CODE}&file=${fileName}`,
    `http://${FS_HOST}:${FS_PORT}/feed/dedicated-server-savegame.xml?code=${FS_CODE}&file=${fileName}`,
  ];
  for (const url of candidates) {
    const txt = await fetchText(url);
    if (txt) {
      console.log(`Fetch OK savegame ${fileName}: ${txt.length} bytes da ${url}`);
      return txt;
    }
  }
  return null;
}

async function fetchFS25Stats(){
  let urls = [];
  if (FEED_URL_ENV) {
    console.log('Uso FEED_URL da ENV:', FEED_URL_ENV);
    urls.push(FEED_URL_ENV);
    if (!FEED_URL_ENV.includes('?code=') && FS_CODE) urls.push(`${FEED_URL_ENV}?code=${FS_CODE}`);
  }
  urls.push(`http://${FS_HOST}:${FS_PORT}/feed/dedicated-server-stats.xml${FS_CODE ? `?code=${FS_CODE}` : ''}`);
  urls.push(`http://${FS_HOST}:${FS_PORT}/feed/dedicated-server-stats.json${FS_CODE ? `?code=${FS_CODE}` : ''}`);
  urls.push(`https://${FS_HOST}:${FS_PORT}/feed/dedicated-server-stats.xml${FS_CODE ? `?code=${FS_CODE}` : ''}`);

  let statsXml = null;
  let usedUrl = null;
  for (const url of urls) {
    try {
      console.log(`Tentativo fetch stats: ${url}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'FS25-Bot' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      console.log(`Fetch OK stats da ${url} - ${xml.length} bytes`);
      if (xml.length < 50) { console.log('Risposta troppo corta:', xml); continue; }
      statsXml = xml;
      usedUrl = url;
      break;
    } catch(e){
      console.error(`Errore fetch FS25 su ${url}:`, e.message);
    }
  }
  if (!statsXml) {
    console.error('Tutti i tentativi falliti per', FS_HOST+':'+FS_PORT);
    return null;
  }

  // parsing base da stats.xml (giocatori)
  const serverName = (statsXml.match(/<name>(.*?)<\/name>/) || [,'Blackout404 Farm'])[1];
  let mapName = (statsXml.match(/<mapName>(.*?)<\/mapName>/) || [,''])[1];
  let money = (statsXml.match(/<money>(.*?)<\/money>/) || [,''])[1];
  let dayTime = (statsXml.match(/<dayTime>(.*?)<\/dayTime>/) || [,''])[1];

  const playerRegex = /<Player[^>]*name="([^"]+)"[^>]*uptime="([^"]+)"[^>]*\/?>/g;
  const players = [];
  let m;
  while ((m = playerRegex.exec(statsXml)) !== null) {
    players.push({ name: m[1], uptime: Math.floor(parseInt(m[2])/60) });
  }
  const slotRegex = /<Slot[^>]*isUsed="true"[^>]*>\s*<Name>(.*?)<\/Name>/g;
  while ((m = slotRegex.exec(statsXml)) !== null) {
    if (!players.find(p=>p.name===m[1])) players.push({ name: m[1], uptime: 0 });
  }
  if (players.length===0 && statsXml.trim().startsWith('{')) {
    try {
      const j = JSON.parse(statsXml);
      if (j.slots) {
        j.slots.forEach(s=>{ if(s.isUsed && s.name) players.push({name:s.name, uptime:0}) });
      }
    } catch {}
  }

  // --- NUOVO: prendi dal SITO DEL GIOCO (stesso IP) i dati del savegame ---
  // Questo è sempre http://46.251.234.146:10910/feed/dedicated-server-savegame.html
  try {
    if (FS_CODE) {
      // 1. Mappa e DayTime da careerSavegame
      const career = await fetchSavegameFile('careerSavegame');
      if (career) {
        // FS25 usa <mapId>, <mapTitle> o <mapName>
        const mapMatch = career.match(/<mapId>(.*?)<\/mapId>/) || career.match(/<mapName>(.*?)<\/mapName>/) || career.match(/<mapTitle>(.*?)<\/mapTitle>/) || career.match(/mapId="([^"]+)"/);
        if (mapMatch && mapMatch[1]) {
          mapName = mapMatch[1];
          console.log('Mappa da careerSavegame:', mapName);
        }
        const dayMatch = career.match(/<dayTime>(.*?)<\/dayTime>/) || career.match(/<dayTimeSec>(.*?)<\/dayTimeSec>/);
        if (dayMatch) dayTime = dayMatch[1];
      }
      // 2. Soldi da farms.xml (FS25)
      if (!money || money === '0') {
        const farms = await fetchSavegameFile('farms');
        if (farms) {
          // FS25: <farm farmId="1" money="123456" ...
          const moneyAttr = farms.match(/<farm[^>]*money="([^"]+)"/) || farms.match(/<money>(.*?)<\/money>/);
          if (moneyAttr) {
            money = moneyAttr[1];
            console.log('Soldi da farms:', money);
          }
        }
      }
      // 3. Fallback economia da economy.xml
      if ((!money || money === '0')) {
        const economy = await fetchSavegameFile('economy');
        if (economy) {
          const econMoney = economy.match(/<money>(.*?)<\/money>/);
          if (econMoney) money = econMoney[1];
        }
      }
    }
  } catch(e) {
    console.log('Errore fetch savegame:', e.message);
  }

  // Fallback finale se ancora vuoti
  if (!mapName) mapName = 'Carpathian Countryside'; // dal tuo screenshot Configuration
  if (!money) money = '0';

  return { serverName, mapName, money, dayTime, players, playerCount: players.length };
}

async function update(){
  console.log('Polling FS25 server...');
  const stats = await fetchFS25Stats();
  if (!stats) return;
  
  // formatta soldi con separatore
  let moneyFormatted = stats.money;
  try {
    const n = parseInt(stats.money);
    if (!isNaN(n)) moneyFormatted = n.toLocaleString('it-IT') + ' €';
  } catch {}

  const embed = new EmbedBuilder()
    .setTitle(`🚜 ${stats.serverName}`)
    .setColor(stats.playerCount > 0 ? 0x00FF00 : 0xFF0000)
    .addFields(
      { name: '🗺 Mappa', value: stats.mapName || 'N/D', inline: true },
      { name: '👥 Giocatori', value: `${stats.playerCount} online`, inline: true },
      { name: '💰 Soldi', value: `${moneyFormatted}`, inline: true },
      { name: '📋 Lista', value: stats.players.length > 0 ? stats.players.map(p => `${p.name} (${p.uptime}m)`).join('\n') : 'Nessun giocatore', inline: false },
      { name: '⏰ DayTime', value: `${stats.dayTime || 'N/D'}`, inline: true },
      { name: '🌐 IP Gioco', value: `${FS_HOST}:${FS_GAME_PORT}`, inline: true },
      { name: '🌐 Web', value: `${FS_HOST}:${FS_PORT}`, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: 'FS25 Bot • dal sito del gioco 46.251.234.146:10910' });

  try {
    if (!channelId) { console.log('Nessun CHANNEL_ID impostato, solo log:', stats); return; }
    const channel = await client.channels.fetch(channelId);
    if (!channel) { console.error('Canale non trovato:', channelId); return; }
    
    if (lastMessageId) {
      try {
        const msg = await channel.messages.fetch(lastMessageId);
        await msg.edit({ embeds: [embed] });
        console.log(`Aggiornato messaggio ${lastMessageId} - ${stats.playerCount} players`);
        return;
      } catch(e){ console.log('Messaggio precedente non trovato, ne creo uno nuovo'); }
    }
    const sent = await channel.send({ embeds: [embed] });
    lastMessageId = sent.id;
    fs.writeFileSync(dbPath, JSON.stringify({ lastMessageId, ...db }, null, 2));
    console.log(`Inviato nuovo embed: ${stats.playerCount} giocatori`);
  } catch(e){
    console.error('Errore invio Discord:', e.message);
  }
}

client.on('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    if (fs.existsSync(dbPath)) {
      const j = JSON.parse(fs.readFileSync(dbPath,'utf8'));
      if (j.lastMessageId) lastMessageId = j.lastMessageId;
    }
  } catch {}
  update();
  intervalTimer = setInterval(() => { update(); }, pollIntervalMillis);
});
client.on('ready', () => client.emit('clientReady'));

const initialise = () => {
  console.log(`Poll interval: ${pollIntervalMillis} milliseconds`);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(dbPath)) {
    try { db = merge(db, JSON.parse(fs.readFileSync(dbPath,'utf8'))); console.log(`Found: ${dbPath}`); }
    catch(e){ console.error(`Unable to read: ${dbPath}`, e); }
  } else {
    console.log(`New DB written: ${dbPath}`);
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
  }
  if (!discordToken) { console.error('TOKEN mancante!'); process.exit(1); }
  client.login(discordToken);
};

process.on('SIGINT', ()=>{ console.log('Logging out SIGINT'); try{ if(intervalTimer) clearInterval(intervalTimer); client.destroy(); }catch{} process.exit(0); });
process.on('SIGTERM', ()=>{ console.log('Logging out SIGTERM'); try{ if(intervalTimer) clearInterval(intervalTimer); client.destroy(); }catch{} process.exit(0); });

initialise();
