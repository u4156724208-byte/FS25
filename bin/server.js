
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

// --- CONFIG CON FALLBACK ---
const dbPath = process.env.FARMING_SIMULATOR_BOT_DATABASE_PATH || '/tmp/database.json';
const pollIntervalMillis = parseInt(process.env.FARMING_SIMULATOR_BOT_POLL_INTERVAL || '60000', 10);
const discordToken = process.env.FARMING_SIMULATOR_BOT_DISCORD_TOKEN || process.env.FARMING_SIMULATOR_BOT_TOKEN;
const channelId = process.env.FARMING_SIMULATOR_BOT_CHANNEL_ID || process.env.DISCORD_CHANNEL_ID;

// Config FS25 - dal tuo server
const FS_HOST = process.env.FS_HOST || '46.251.234.146';
const FS_PORT = process.env.FS_PORT || '10900';
const FS_CODE = process.env.FS_CODE || ''; // se hai un ?code=xxx mettilo qui nelle env vars

let db = { servers: [] };
function merge(t,s){ return Object.assign(t,s); }

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

let intervalTimer;
let lastMessageId = null;

async function fetchFS25Stats(){
  const url = `http://${FS_HOST}:${FS_PORT}/feed/dedicated-server-stats.xml${FS_CODE ? `?code=${FS_CODE}` : ''}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    // Parse semplice senza xml parser per Render free
    const serverName = (xml.match(/<name>(.*?)<\/name>/) || [,'FS25 Server'])[1];
    const mapName = (xml.match(/<mapName>(.*?)<\/mapName>/) || [,''])[1];
    const money = (xml.match(/<money>(.*?)<\/money>/) || [,'0'])[1];
    const dayTime = (xml.match(/<dayTime>(.*?)<\/dayTime>/) || [,'0'])[1];
    
    // Players: <Player name="..." isAdmin="false" uptime="123"/>
    const playerRegex = /<Player[^>]*name="([^"]+)"[^>]*uptime="([^"]+)"[^>]*\/?>/g;
    const players = [];
    let m;
    while ((m = playerRegex.exec(xml)) !== null) {
      players.push({ name: m[1], uptime: Math.floor(parseInt(m[2])/60) });
    }
    // Altro formato <Slot ... isUsed="true"><Name>...</Name>
    const slotRegex = /<Slot[^>]*isUsed="true"[^>]*>\s*<Name>(.*?)<\/Name>/g;
    while ((m = slotRegex.exec(xml)) !== null) {
      if (!players.find(p=>p.name===m[1])) players.push({ name: m[1], uptime: 0 });
    }

    return { serverName, mapName, money, dayTime, players, playerCount: players.length, raw: xml.substring(0,500) };
  } catch(e){
    console.error('Errore fetch FS25:', e.message);
    return null;
  }
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
      { name: '⏰ DayTime', value: stats.dayTime, inline: true },
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
    // Salva su db per persistenza
    fs.writeFileSync(dbPath, JSON.stringify({ lastMessageId, ...db }, null, 2));
    console.log(`Inviato nuovo embed: ${stats.playerCount} giocatori`);
  } catch(e){
    console.error('Errore invio Discord:', e.message);
  }
}

client.on('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`);
  // Carica lastMessageId se esiste
  try {
    if (fs.existsSync(dbPath)) {
      const j = JSON.parse(fs.readFileSync(dbPath,'utf8'));
      if (j.lastMessageId) lastMessageId = j.lastMessageId;
    }
  } catch {}
  update();
  intervalTimer = setInterval(() => { update(); }, pollIntervalMillis);
});
// fallback per vecchia versione discord.js
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
