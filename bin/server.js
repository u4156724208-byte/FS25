
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');

// --- CONFIG CON FALLBACK ANTI-CRASH ---
const dbPath = process.env.FARMING_SIMULATOR_BOT_DATABASE_PATH || '/tmp/database.json';
const pollIntervalMillis = parseInt(process.env.FARMING_SIMULATOR_BOT_POLL_INTERVAL || '60000', 10);
const discordToken = process.env.FARMING_SIMULATOR_BOT_DISCORD_TOKEN || process.env.FARMING_SIMULATOR_BOT_TOKEN;

let db = { servers: [] };
function merge(target, source) { return Object.assign(target, source); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

let intervalTimer;
async function update() {
  console.log('Polling FS25 server...');
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  update();
  intervalTimer = setInterval(() => { update(); }, pollIntervalMillis);
});

const initialise = () => {
  console.log(`Poll interval: ${pollIntervalMillis} milliseconds`);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (fs.existsSync(dbPath)) {
    try {
      db = merge(db, JSON.parse(fs.readFileSync(dbPath, 'utf8')));
      console.log(`Found: ${dbPath}`);
    } catch (e) {
      console.error(`Unable to read: ${dbPath}`, e);
    }
  } else {
    console.log(`New DB written: ${dbPath}`);
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
  }
  if (!discordToken) {
    console.error('ERRORE: TOKEN non impostato!');
    process.exit(1);
  }
  client.login(discordToken);
};

process.on('beforeExit', (code) => {
  console.log('Process beforeExit event with code: ', code);
});

// Gestione chiusura senza signal-exit
process.on('SIGINT', () => {
  console.log('Logging out');
  try { if (intervalTimer) clearInterval(intervalTimer); client.destroy(); } catch {}
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('Logging out');
  try { if (intervalTimer) clearInterval(intervalTimer); client.destroy(); } catch {}
  process.exit(0);
});

initialise();
