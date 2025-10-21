const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const app = express();
const PORT = 3000; 

const SPRING_BOOT_API_URL = 'http://localhost:8080/api/'; 

const client = new Client({
    authStrategy: new LocalAuth(), 
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ],
    }
});


client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('QR RECEIVED. Scan this QR code with your WhatsApp linked devices.');
});

client.on('ready', () => {
    console.log('Client is ready! O bot está conectado e pronto para receber mensagens.');
});

async function processCommand(message) {
    const body = message.body.toLowerCase().trim();
    const parts = body.split(' ');
    
    const command = parts[0]; 
    
    const value = parseFloat(parts[1]); 
    const description = parts.slice(2).join(' ');

    if (isNaN(value) || value <= 0) {
        return message.reply('Comando inválido. Formato: [comando] [valor] [descrição]. Ex: entrada 100 salário');
    }

    const transactionData = {
        valor: value,
        descricao: description,
        data: new Date().toISOString().split('T')[0]
    };

    let endpoint = '';

    if (command === 'entrada') {
        endpoint = '/entradas';
    } else if (command === 'saida') {
        endpoint = '/saidas';
    } else {
        return message.reply('Comando não reconhecido. Use "entrada" ou "saida".');
    }

    try {
        const url = SPRING_BOOT_API_URL + endpoint;
        
        await axios.post(url, transactionData);

        message.reply(`✅ ${command.toUpperCase()} de R$ ${value.toFixed(2)} (${description}) registrada com sucesso no FinanZas!`);
    } catch (error) {
        console.error('Erro ao comunicar com o Spring Boot:', error.message);
        message.reply('❌ Ocorreu um erro ao registrar a transação. Verifique se o seu backend Spring Boot está rodando.');
    }
}

client.on('message', async message => {
    if (message.body.toLowerCase().startsWith('entrada') || message.body.toLowerCase().startsWith('saida')) {
        await processCommand(message);
    } else if (message.body.toLowerCase() === 'olá') {
        message.reply('Olá! Eu sou o FinanZas Bot. Use comandos como "entrada 100 salário" ou "saida 50 almoço" para registrar suas transações.');
    }
});

client.initialize();


app.use(express.json());

app.listen(PORT, () => {
    console.log(`Servidor Node.js Bot rodando na porta ${PORT}`);
    console.log(`Conectando ao Spring Boot em: ${SPRING_BOOT_API_URL}`);
});