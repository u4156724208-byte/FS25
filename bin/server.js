import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import http from 'http';

// Mini web server per Render (obbligatorio per Web Service)
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('FS25 Bot Running - OK');
}).listen(PORT, () => console.log(`Web server per Render su porta ${PORT}`));

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

console.log('=== ENV CHECK ===');
let BOT_TOKEN = null;
for (const k of Object.keys(process.env)) {
  if (k.toUpperCase().includes('TOKEN') && process.env[k]?.length > 20) {
    BOT_TOKEN = process.env[k];
    console.log(`Trovato TOKEN in ${k} len=${BOT_TOKEN.length}`);
    break;
  }
}
const FS25_IP = '46.251.234.146';
const FS25_PORT = '10910';
const FS25_CODE = process.env.FS_CODE || process.env.FARMING_SIMULATOR_BOT_CODE || 'ef83050ebbeba59d4509436dc14f1e3e';
const FS25_DASH = `http://${FS25_IP}:${FS25_PORT}`;
const STATUS_CHANNEL_ID = process.env.FARMING_SIMULATOR_BOT_CHANNEL_ID || '1556754791168737391';
const STATUS_MESSAGE_ID = process.env.FARMING_SIMULATOR_BOT_MESSAGE_ID || '1557583647530295297';

console.log(`CHANNEL=${STATUS_CHANNEL_ID} MESSAGE=${STATUS_MESSAGE_ID} FS_CODE=${FS25_CODE}`);

function prettyMapName(raw){if(!raw)return'N/D';let s=raw.trim();if(s.includes('.'))s=s.split('.').pop();if(s.startsWith('FS25_'))s=s.substring(5);s=s.replace(/_/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2');return s.trim();}
function formatMoney(num){if(num===null||isNaN(num))return'N/D';return new Intl.NumberFormat('it-IT').format(Math.floor(num))+' $';}

async function fetchSavegameFile(fileNameBase){
  const candidates=[`${FS25_DASH}/feed/dedicated-server-savegame.html?code=${FS25_CODE}&file=${fileNameBase}.xml`,`${FS25_DASH}/feed/dedicated-server-savegame.xml?code=${FS25_CODE}&file=${fileNameBase}.xml`,`${FS25_DASH}/feed/dedicated-server-savegame.html?code=${FS25_CODE}&file=${fileNameBase}`,`${FS25_DASH}/feed/dedicated-server-savegame.xml?code=${FS25_CODE}&file=${fileNameBase}`,];
  if(fileNameBase==='farms'){candidates.push(`${FS25_DASH}/feed/dedicated-server-savegame.html?code=${FS25_CODE}&file=farm.xml`);candidates.push(`${FS25_DASH}/feed/dedicated-server-savegame.xml?code=${FS25_CODE}&file=farm.xml`);}
  for(const url of candidates){
    try{
      const controller=new AbortController();const t=setTimeout(()=>controller.abort(),10000);
      const res=await fetch(url,{signal:controller.signal});clearTimeout(t);
      if(!res.ok){console.log(`Fetch fallito ${fileNameBase} ${url}: HTTP ${res.status}`);continue;}
      const text=await res.text();
      if(!text||text.trim().length<50){console.log(`Fetch vuoto ${fileNameBase} ${url}: ${text.length} bytes`);continue;}
      if(text.includes('<html')||text.includes('<head')){
        const m=text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if(m&&m[1].length>50){console.log(`Fetch OK ${fileNameBase} via wrapper: ${m[1].length} bytes`);return m[1];}
        if(text.includes('<farms>')||text.includes('<farm ')||text.includes('<careerSavegame')||text.includes('<economy')||text.includes('<career>')){
          console.log(`Fetch OK ${fileNameBase} (xml in html): ${text.length} bytes`);return text;
        }
        console.log(`Fetch fallito ${fileNameBase}: html senza savegame ${text.length}`);continue;
      }
      console.log(`Fetch OK ${fileNameBase}: ${text.length} bytes da ${url}`);
      return text;
    }catch(e){console.log(`Fetch errore ${fileNameBase}: ${e.message}`);}
  }
  return null;
}

function parseMoneyFromAnyXml(xml){
  if(!xml) return null;
  try{
    const farmMoneyMatches=[...xml.matchAll(/<farm[^>]*money="([^"]+)"/gi)];
    if(farmMoneyMatches.length>0){
      let best=null;
      for(const m of farmMoneyMatches){
        const money=parseFloat(m[1]);
        if(!isNaN(money)){ if(best===null||money>best) best=money; }
      }
      if(best!==null){ console.log(`Trovato money da <farm money>: ${best}`); return best; }
    }
    let moneyTag=xml.match(/<money[^>]*>([^<]+)<\/money>/i);
    if(moneyTag){ const v=parseFloat(moneyTag[1].replace(/[^0-9.-]/g,'')); if(!isNaN(v)){ console.log(`Trovato money da <money>: ${v}`); return v; } }
    moneyTag=xml.match(/<Money[^>]*>([^<]+)<\/Money>/);
    if(moneyTag){ const v=parseFloat(moneyTag[1].replace(/[^0-9.-]/g,'')); if(!isNaN(v)){ console.log(`Trovato money da <Money>: ${v}`); return v; } }
    const generic=xml.match(/money\s*=\s*"([^"]+)"/i);
    if(generic){ const v=parseFloat(generic[1]); if(!isNaN(v)){ console.log(`Trovato money generico: ${v}`); return v; } }
  }catch{}
  return null;
}
function parseMapFromCareer(xml){
  if(!xml) return null;
  try{
    let m=xml.match(/<mapId[^>]*>([^<]+)<\/mapId>/i); if(m) return m[1].trim();
    m=xml.match(/<mapTitle[^>]*>([^<]+)<\/mapTitle>/i); if(m) return m[1].trim();
    m=xml.match(/<map[^>]*>([^<]+)<\/map>/i); if(m) return m[1].trim();
    m=xml.match(/mapId="([^"]+)"/i); if(m) return m[1].trim();
  }catch{}
  return null;
}

async function getServerStats(){
  try{
    const statsRes=await fetch(`${FS25_DASH}/feed/dedicated-server-stats.xml?code=${FS25_CODE}`);
    let statsXml=statsRes.ok?await statsRes.text():'';
    console.log(`Stats fetch: ${statsXml.length} bytes`);
    
    let serverName='Farming Simulator 25';
    let players=[]; let maxPlayers='?'; let currentPlayers=0;
    if(statsXml){
      const nameMatch=statsXml.match(/<name[^>]*>([^<]+)<\/name>/i); if(nameMatch) serverName=nameMatch[1];
      const slotsMatch=statsXml.match(/<Slots[^>]*>\s*<Capacity[^>]*>([^<]+)<\/Capacity>\s*<Used[^>]*>([^<]+)<\/Used>/i);
      if(slotsMatch){ maxPlayers=slotsMatch[1]; currentPlayers=parseInt(slotsMatch[2])||0; }
      const playerMatches=[...statsXml.matchAll(/<Player[^>]*>([^<]+)<\/Player>/gi)];
      players=playerMatches.map(m=>m[1].trim()).filter(Boolean);
    }

    const careerXml=await fetchSavegameFile('careerSavegame');
    let rawMap=parseMapFromCareer(careerXml);
    let mapPretty=rawMap?prettyMapName(rawMap):'N/D';
    if(rawMap) console.log(`Mappa: ${rawMap} -> ${mapPretty}`);

    const economyXml=await fetchSavegameFile('economy');
    if(economyXml) console.log(`Economy OK: ${economyXml.length} bytes`);

    const farmsXml=await fetchSavegameFile('farms');

    let money=null;
    let moneySource='nessuno';
    
    money=parseMoneyFromAnyXml(farmsXml);
    if(money!==null){ moneySource='farms.xml'; }
    
    if(money===null){
      money=parseMoneyFromAnyXml(economyXml);
      if(money!==null) moneySource='economy.xml';
    }
    if(money===null){
      money=parseMoneyFromAnyXml(statsXml);
      if(money!==null) moneySource='stats.xml';
    }
    if(money===null && careerXml){
      money=parseMoneyFromAnyXml(careerXml);
      if(money!==null) moneySource='careerSavegame.xml';
    }

    if(money!==null) console.log(`>>> SOLDI TROVATI da ${moneySource}: ${money}`);
    else console.log(`>>> Soldi non trovati, farms: ${!!farmsXml} economy: ${!!economyXml} stats: ${!!statsXml}`);

    return { serverName, map: mapPretty, rawMap, money, moneyFormatted: money!==null?formatMoney(money):'N/D', players, currentPlayers, maxPlayers, online:true, moneySource };
  }catch(e){ console.log(`Errore getServerStats: ${e.message}`); return { online:false, error:e.message }; }
}

async function updateStatusMessage(){
  try{
    const stats=await getServerStats();
    if(!stats.online){ console.log('Server offline'); return; }
    const channel=await client.channels.fetch(STATUS_CHANNEL_ID); if(!channel){ console.log(`Canale ${STATUS_CHANNEL_ID} non trovato`); return; }
    const msg=await channel.messages.fetch(STATUS_MESSAGE_ID).catch(()=>null);
    if(!msg){ console.log(`Messaggio ${STATUS_MESSAGE_ID} non trovato`); return; }
    const embed=new EmbedBuilder().setTitle(`🌾 ${stats.serverName}`).setColor(stats.currentPlayers>0?0x57F287:0xFEE75C).addFields({name:'🗺️ Mappa',value:stats.map,inline:true},{name:'💰 Soldi Fattoria',value:stats.moneyFormatted,inline:true},{name:'👥 Giocatori',value:`${stats.currentPlayers}/${stats.maxPlayers}`,inline:true},{name:'👨‍🌾 Online',value:stats.players.length>0?stats.players.join(', '):(stats.currentPlayers>0?`${stats.currentPlayers} giocatori`:'Nessuno'),inline:false}).setFooter({text:`Aggiornato • ${stats.moneySource||''} • IP: ${FS25_IP}:${FS25_PORT}`}).setTimestamp();
    await msg.edit({embeds:[embed]});
    console.log(`Aggiornato Discord - Mappa: ${stats.map} - Soldi: ${stats.moneyFormatted} da ${stats.moneySource}`);
  }catch(e){ console.log(`Errore updateStatus: ${e.message}`); }
}

client.once('ready',async()=>{console.log(`Logged in as ${client.user.tag}`);setInterval(updateStatusMessage,60000);await updateStatusMessage();});
if(!BOT_TOKEN){console.error('TOKEN mancante!');process.exit(1);}
client.login(BOT_TOKEN);
