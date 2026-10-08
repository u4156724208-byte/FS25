import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import http from 'http';
http.createServer((req,res)=>{res.writeHead(200);res.end('FS25 Bot Live');}).listen(process.env.PORT||10000);
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] });

let BOT_TOKEN=null;
for(const k of Object.keys(process.env)){ if(k.toUpperCase().includes('TOKEN') && process.env[k]?.length>20){ BOT_TOKEN=process.env[k]; console.log(`Token trovato in ${k}`); break; } }

const FS25_IP='46.251.234.146'; const FS25_PORT='10910'; const FS25_CODE=process.env.FS_CODE||process.env.FARMING_SIMULATOR_BOT_CODE||'ef83050ebbeba59d4509436dc14f1e3e';
const FS25_DASH=`http://${FS25_IP}:${FS25_PORT}`;
const STATUS_CHANNEL_ID=process.env.FARMING_SIMULATOR_BOT_CHANNEL_ID||'1556754791168737391';
let STATUS_MESSAGE_ID=process.env.FARMING_SIMULATOR_BOT_MESSAGE_ID||'1557583647530295297';

function prettyMap(raw){ if(!raw) return 'Carpathian Countryside'; let s=raw.trim(); if(s.includes('.')) s=s.split('.').pop(); s=s.replace(/FS25_/g,'').replace(/_/g,' ').replace(/crossplay/gi,'').replace(/([a-z])([A-Z])/g,'$1 $2'); return s.trim(); }
function formatMoney(n){ if(n===null||isNaN(n)) return '0 €'; return new Intl.NumberFormat('it-IT').format(Math.floor(n))+' €'; }

async function fetchSaveFile(file){
  const urls=[`${FS25_DASH}/feed/dedicated-server-savegame.html?code=${FS25_CODE}&file=${file}`,`${FS25_DASH}/feed/dedicated-server-savegame.html?code=${FS25_CODE}&file=${file}.xml`];
  for(const url of urls){ try{ const r=await fetch(url); const t=await r.text(); const m=t.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i); const xml=m?m[1]:t; if(xml && xml.length>100) return xml; }catch{} } return null;
}

async function getData(){
  const statsRes=await fetch(`${FS25_DASH}/feed/dedicated-server-stats.xml?code=${FS25_CODE}`);
  const statsXml=await statsRes.text();
  console.log(`Stats: ${statsXml.length} bytes`);
  let serverName='Blackout404 Farm'; let players=[]; let maxP='6';
  const nameM=statsXml.match(/<name[^>]*>([^<]+)<\/name>/i); if(nameM) serverName=nameM[1];
  const capM=statsXml.match(/<Capacity>([^<]+)<\/Capacity>/i); if(capM) maxP=capM[1];
  const pMatches=[...statsXml.matchAll(/<Player[^>]*>([^<]+)<\/Player>/gi)]; players=pMatches.map(m=>m[1].trim());

  const careerXml=await fetchSaveFile('careerSavegame');
  let rawMap=null; if(careerXml){ const mm=careerXml.match(/<mapId[^>]*>([^<]+)<\/mapId>/i)||careerXml.match(/mapId="([^"]+)"/i); if(mm) rawMap=mm[1]; }
  let mapPretty=rawMap?prettyMap(rawMap):'Carpathian Countryside';
  let money=null;
  if(careerXml){ const moneyM=careerXml.match(/<money[^>]*>([^<]+)<\/money>/i); if(moneyM) money=parseFloat(moneyM[1]); }
  if(money===null){ console.log('Money non trovato in career, provo farms ma e vuoto'); }
  console.log(`>>> DATI: Mappa=${mapPretty} Soldi=${money} Players=${players.length}`);
  return { serverName, map: mapPretty, money, players, maxP };
}

async function update(){
  try{
    const d=await getData();
    const ch=await client.channels.fetch(STATUS_CHANNEL_ID);
    if(!ch){ console.log(`Canale ${STATUS_CHANNEL_ID} non trovato`); return; }
    console.log(`Canale trovato: ${ch.name}`);
    
    let msg=null;
    try{
      msg=await ch.messages.fetch(STATUS_MESSAGE_ID);
      console.log(`Messaggio ${STATUS_MESSAGE_ID} trovato`);
    }catch(e){
      console.log(`Messaggio ${STATUS_MESSAGE_ID} NON trovato o non editabile: ${e.message} -> creo nuovo messaggio`);
      msg=null;
    }

    const embed=new EmbedBuilder()
      .setTitle(`🚜 ${d.serverName}`)
      .setColor(0x2ECC71)
      .addFields(
        { name:'🗺️ Mappa', value: d.map, inline:true },
        { name:'👥 Giocatori', value: `${d.players.length} online`, inline:true },
        { name:'💰 Soldi', value: d.money!==null?formatMoney(d.money):'0 €', inline:true },
        { name:'📋 Lista', value: d.players.length?d.players.join(', '):'Nessun giocatore', inline:false },
        { name:'⏰ DayTime', value: new Date().toLocaleString('it-IT'), inline:true },
        { name:'🌐 IP Gioco', value: `${FS25_IP}:10900`, inline:true },
        { name:'🌐 Web', value: `${FS25_IP}:${FS25_PORT}`, inline:true },
      )
      .setFooter({ text:`FS25 Bot • ${FS25_IP}:${FS25_PORT} • ${new Date().toLocaleTimeString('it-IT')}` })
      .setTimestamp();

    if(msg){
      await msg.edit({ embeds:[embed] });
      console.log(`>>> EDITATO messaggio esistente ${STATUS_MESSAGE_ID}`);
    }else{
      const newMsg=await ch.send({ embeds:[embed] });
      console.log(`>>> CREATO NUOVO MESSAGGIO ID: ${newMsg.id} nel canale ${STATUS_CHANNEL_ID}`);
      console.log(`>>> COPIA QUESTO ID e mettilo in FARMING_SIMULATOR_BOT_MESSAGE_ID su Render: ${newMsg.id}`);
    }
  }catch(e){ console.log('Errore update: '+e.stack); }
}

client.once('ready',()=>{ console.log(`Bot pronto come ${client.user.tag}`); setInterval(update, 30000); update(); });
if(!BOT_TOKEN){ console.error('TOKEN MANCANTE'); process.exit(1); }
client.login(BOT_TOKEN);
