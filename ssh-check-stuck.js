const { Client } = require('C:\\Users\\JC\\OneDrive - Madison88\\AP Invoice\\node_modules\\.pnpm\\ssh2@1.17.0\\node_modules\\ssh2');

const conn = new Client();

conn.on('ready', () => {
  console.log('SSH connected. Checking stuck invoices...');

  const cmds = [
    'echo "=== Invoices in OCR_PROCESSING / RECEIVED ==="',
    'cd /opt/ap-invoice && node -e "const{PrismaClient}=require(\'@prisma/client\');const p=new PrismaClient();p.invoice.findMany({where:{status:{in:[\'OCR_PROCESSING\',\'RECEIVED\']}},select:{id:true,invoice_number:true,status:true,created_at:true}}).then(r=>{console.log(JSON.stringify(r,null,2));p.$disconnect()}).catch(e=>{console.error(e);p.$disconnect()})" 2>&1',
    'echo "=== Upload queue files ==="',
    'ls -la /opt/ap-invoice/data/invoice-upload-queue/ 2>&1 | head -20',
    'echo "=== API service status ==="',
    'systemctl status ap-invoice-api 2>&1 | head -10',
    'echo DONE',
  ];

  let i = 0;
  const runNext = () => {
    if (i >= cmds.length) { console.log('ALL DONE'); conn.end(); return; }
    const cmd = cmds[i++];
    conn.exec(cmd, (err, stream) => {
      if (err) { console.error('Err:', err); runNext(); return; }
      let out = '';
      stream.on('data', d => out += d);
      stream.stderr.on('data', d => out += d);
      stream.on('close', () => { console.log(out.trim()); runNext(); });
    });
  };
  runNext();
});

conn.on('error', (err) => console.error('SSH error:', err.message));
conn.connect({ host: '5.223.78.194', port: 22, username: 'root', password: 'M@dis0n_88_server*', readyTimeout: 15000 });
