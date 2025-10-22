const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const app = express();
const PORT = 3000; 

const API_BASE_URL = 'http://localhost:8080/api'; 

const userMap = {}; 

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "finanzas-bot" }), 
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
    console.log('✅ WhatsApp Client está pronto! O bot está conectado e pronto para receber mensagens.');
    console.log(`Conectando ao Spring Boot em: ${API_BASE_URL}`);
});

client.on('auth_failure', msg => {
    console.error('❌ Falha na Autenticação:', msg);
});

client.on('disconnected', (reason) => {
    console.log('Cliente desconectado', reason);
    client.initialize();
});


async function processCommand(message) {
    const text = message.body.trim();
    const whatsappId = message.from;

    if (text.toUpperCase().startsWith('CONECTAR ')) {
        const finanzasUserId = text.substring(9).trim(); 
        
        if (finanzasUserId.length < 5) {
            return message.reply('❌ ID de usuário inválido. Por favor, forneça o ID de usuário (UID) correto do Firebase.');
        }

        if (!/^[a-zA-Z0-9]{20,}$/.test(finanzasUserId)) {
             return message.reply('❌ ID de usuário inválido. O ID deve ser uma string longa alfanumérica (seu UID do Firebase).');
        }
        
        userMap[whatsappId] = finanzasUserId;
        return message.reply(`✅ Conta FinanZas (${finanzasUserId}) associada com sucesso! Agora você pode registrar transações.`);
    }

    const userId = userMap[whatsappId];

    if (!userId) {
        return message.reply('⚠️ Sua conta do FinanZas ainda não está conectada. Envie "CONECTAR {seu_id_usuario}" (Ex: CONECTAR A1B2C3D4E5) para começar a usar.');
    }
    
    const parts = text.toLowerCase().split(' ');
    const command = parts[0]; 
    const valueStr = parts[1];
    
    const rawDescription = parts.slice(2).join(' '); 
    const description = rawDescription || (command === 'entrada' ? 'Entrada via WhatsApp' : 'Saída via WhatsApp');


    if (command !== 'entrada' && command !== 'saida') {
        return message.reply('Comando não reconhecido. Use "ajuda" para ver a lista de comandos.');
    }

    const value = parseFloat(valueStr.replace(',', '.')); 

    if (isNaN(value) || value <= 0) {
        return message.reply(`❌ Valor inválido para ${command}. Use o formato: ${command} [valor] [descrição]. Ex: entrada 100 salário`);
    }

    const isEntrada = command === 'entrada';

    const payload = {
        descricao: description,
        valor: value, 
        data: new Date().toISOString().split('T')[0], 
        ...(isEntrada 
            ? { salario: description.toLowerCase().includes('salário') || description.toLowerCase().includes('fixo') } 
            : { tipo: description.toLowerCase().includes('fixa') ? 'fixa' : 'variável' }), 
    };

    const endpoint = isEntrada ? '/entradas' : '/saidas';

    try {
        const url = `${API_BASE_URL}${endpoint}?userId=${userId}`;
        
        await axios.post(url, payload);

        const typeLabel = isEntrada ? 'Entrada' : 'Saída';
        const formattedValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
        
        message.reply(`✅ ${typeLabel} de ${formattedValue} (${payload.descricao}) registrada com sucesso no FinanZas!`);
    } catch (error) {
        console.error('Erro ao comunicar com o Spring Boot:', error.response ? error.response.data : error.message);
        
        let errorMessage = 'Erro desconhecido ao registrar a transação.';
        if (error.response && error.response.status === 404) {
            errorMessage = 'O endpoint da API não foi encontrado (404). Verifique se o backend está na URL correta e rodando na porta 8080.';
        } else if (error.message.includes('ECONNREFUSED')) {
             errorMessage = 'Conexão recusada. O Spring Boot não está rodando no endereço especificado.';
        } else if (error.response && error.response.status === 400) {
             errorMessage = 'Requisição inválida (400). Verifique se os dados da transação estão no formato correto.';
        }

        message.reply(`❌ Ocorreu um erro: ${errorMessage}`);
    }
}

client.on('message', async message => {
    const body = message.body.toLowerCase().trim();
    if (body.startsWith('conectar') || body.startsWith('entrada') || body.startsWith('saida')) {
        await processCommand(message);
    } else if (body === 'ajuda') {
         message.reply(`
Comandos disponíveis:
1. **Conectar conta:** CONECTAR {seu_id_usuario}
   Ex: CONECTAR SEUID123
2. **Registrar Entrada:** entrada [valor] [descrição/tipo]
   Ex: entrada 2000 Salário fixo
3. **Registrar Saída:** saida [valor] [descrição/tipo]
   Ex: saida 45 Almoço variavel
        `);
    } else if (body === 'olá') {
        message.reply('Olá! Eu sou o FinanZas Bot. Envie "ajuda" para ver a lista de comandos e "CONECTAR {seu_id_usuario}" para começar.');
    }
});

client.initialize();


app.use(express.json());

app.listen(PORT, () => {
});