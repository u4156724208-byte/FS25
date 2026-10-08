
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const dbPath = process.env.FARMING_SIMULATOR_BOT_DATABASE_PATH || '/tmp/database.json';
const pollIntervalMillis = parseInt(process.env.FARMING_SIMULATOR_BOT_POLL_INTERVAL || '60000', 10);
const discordToken = process.env.FARMING_SIMULATOR_BOT_DISCORD_TOKEN || process.env.FARMING_SIMULATOR_BOT_TOKEN;
const channelId = process.env.FARMING_SIMULATOR_BOT_CHANNEL_ID || process.env.DISCORD_CHANNEL_ID;

const FS_HOST = process.env.FS_HOST || '46.251.234.146';
const FS_PORT = process.env.FS_PORT || '10900';
const FS_CODE = process.env.FS_CODE || '';

let db = { servers: [] };
function merge(t,s){ return Object.assign(t,s); }

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

let intervalTimer;
let lastMessageId = null;

async function fetchFS25Stats(){
  const urls = [
    `http://${FS_HOST}:${FS_PORT}/feed/dedicated-server-stats.xml${FS_CODE ? `?code=${FS_CODE}` : ''}`,
    `http://${FS_HOST}:${FS_PORT}/feed/dedicated-server-stats.json${FS_CODE ? `?code=${FS_CODE}` : ''}`,
    `https://${FS_HOST}:${FS_PORT}/feed/dedicated-server-stats.xml${FS_CODE ? `?code=${FS_CODE}` : ''}`
  ];
  for (const url of urls) {
    try {
      console.log(`Tentativo fetch: ${url}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'FS25-Bot' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      console.log(`Fetch OK da ${url} - ${xml.length} bytes`);
      if (xml.length < 50) { console.log('Risposta troppo corta:', xml); continue; }
      const serverName = (xml.match(/<name>(.*?)<\/name>/) || [,'FS25 Server'])[1];
      const mapName = (xml.match(/<mapName>(.*?)<\/mapName>/) || [,''])[1];
      const money = (xml.match(/<money>(.*?)<\/money>/) || [,'0'])[1];
      const dayTime = (xml.match(/<dayTime>(.*?)<\/dayTime>/) || [,'0'])[1];
      const playerRegex = /<Player[^>]*name="([^"]+)"[^>]*uptime="([^"]+)"[^>]*\/?>/g;
      const players = [];
      let m;
      while ((m = playerRegex.exec(xml)) !== null) {
        players.push({ name: m[1], uptime: Math.floor(parseInt(m[2])/60) });
      }
      const slotRegex = /<Slot[^>]*isUsed="true"[^>]*>\s*<Name>(.*?)<\/Name>/g;
      while ((m = slotRegex.exec(xml)) !== null) {
        if (!players.find(p=>p.name===m[1])) players.push({ name: m[1], uptime: 0 });
      }
      // json fallback
      if (players.length===0 && xml.trim().startsWith('{')) {
        try {
          const j = JSON.parse(xml);
          if (j.slots) {
            j.slots.forEach(s=>{ if(s.isUsed && s.name) players.push({name:s.name, uptime:0}) });
          }
        } catch {}
      }
      return { serverName, mapName, money, dayTime, players, playerCount: players.length };
    } catch(e){
      console.error(`Errore fetch FS25 su ${url}:`, e.message);
    }
  }
  console.error('Tutti i tentativi falliti per', FS_HOST+':'+FS_PORT);
  return null;
}

async function update(){
  console.log('Polling FS25 server...');
  const stats = await fetchFS25Stats();
  if (!stats) return;
  
  const embed = new EmbedBuilder()
    .setTitle(`🚜 ${stats.serverName}`)
    .setColor(stats.playerCount > 0 ? 0x00FF00 : 0xFF0000)
    .addFields(
      { name: '🗺️ Mappa', value: stats.mapName || 'N/D', inline: true },
      { name: '👥 Giocatori', value: `${stats.playerCount} online`, inline: true },
      { name: '💰 Soldi', value: `${stats.money}`, inline: true },
      { name: '📋 Lista', value: stats.players.length > 0 ? stats.players.map(p => `${p.name} (${p.uptime}m)`).join('\n') : 'Nessun giocatore', inline: false },
      { name: '⏰ DayTime', value: `${stats.dayTime}`, inline: true },
      { name: '🌐 IP', value: `${FS_HOST}:${FS_PORT}`, inline: true }
    )
    .setTimestamp()
    .setFooter({ text: 'FS25 Bot • Aggiornato ogni minuto' });

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
