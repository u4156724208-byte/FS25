const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req,res)=>{ res.send('FS25 Discord Bot ONLINE! 🚜 - '+new Date().toISOString()); });
app.get('/health', (req,res)=>{ res.json({status:'ok',uptime:process.uptime(),timestamp:new Date()}); });
app.listen(PORT, ()=>{ console.log(`Mini web server attivo su porta ${PORT} per Render`); });
require('./bin/server.js');
