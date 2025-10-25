const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const app = express();
const PORT = 3000;

const API_BASE_URL = 'http://localhost:8080/api';

const userMap = {};

const userSessionState = {};

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


/**
 * Processa o registro de uma transação (entrada ou saida)
 * * @param {Message} message - O objeto 'message' ORIGINAL do whatsapp-web.js
 * @param {string} text - O texto do comando a ser processado
 */
async function processTransaction(message, text) {
    const whatsappId = message.from;
    const userId = userMap[whatsappId];

    const parts = text.toLowerCase().split(' ');
    const command = parts[0];
    const valueStr = parts[1];

    const rawDescription = parts.slice(2).join(' ');
    const description = rawDescription || (command === 'entrada' ? 'Entrada via WhatsApp' : 'Saída via WhatsApp');

    if (command !== 'entrada' && command !== 'saida') {
        await message.reply('Comando não reconhecido. Digite *MENU* para ver as opções.');
        return false;
    }

    const value = parseFloat(valueStr.replace(',', '.'));

    if (isNaN(value) || value <= 0) {
        await message.reply(`❌ Valor inválido. Use o formato: [valor] [descrição].\nEx: 100 salário`);
        return false;
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
        return true;
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
        return false;
    }
}

/**
 * Busca e envia o resumo financeiro para o usuário.
 * @param {Message} message - O objeto 'message' ORIGINAL do whatsapp-web.js
 */
async function getFinancialSummary(message) {
    const whatsappId = message.from;
    const userId = userMap[whatsappId];

    try {
        const urlEntradas = `${API_BASE_URL}/entradas/total?userId=${userId}`;
        const urlSaidas = `${API_BASE_URL}/saidas/total?userId=${userId}`;

        const [entradasResponse, saidasResponse] = await Promise.all([
            axios.get(urlEntradas),
            axios.get(urlSaidas)
        ]);
        
        const totalEntradas = entradasResponse.data.total;
        const totalSaidas = saidasResponse.data.total;
        const saldo = totalEntradas - totalSaidas;

        const formatCurrency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

        const summaryMessage = 
`*📊 Resumo Financeiro*

*Entradas (Total)*: ${formatCurrency(totalEntradas)}
*Saídas (Total)*: ${formatCurrency(totalSaidas)}
*Saldo Atual (Entradas - Saídas)*: ${formatCurrency(saldo)}`;

        await message.reply(summaryMessage);

        return true;
    } catch (error) {
        console.error('Erro ao buscar resumo financeiro no Spring Boot:', error.response ? error.response.data : error.message);

        let errorMessage = 'Erro desconhecido ao buscar o resumo financeiro.';
        if (error.message.includes('ECONNREFUSED')) {
            errorMessage = 'Conexão recusada. O Spring Boot não está rodando no endereço especificado.';
        } else if (error.response && (error.response.status === 404 || error.response.status === 500)) {
            // Este erro é comum se o Spring Boot não tiver os endpoints /entradas/total e /saidas/total implementados.
            errorMessage = 'O endpoint da API para resumo não foi encontrado ou houve erro no servidor. Verifique se o backend está implementado para os endpoints `/entradas/total` e `/saidas/total` ou se há algum problema interno.';
        } else if (error.response && error.response.status === 400) {
            errorMessage = 'Requisição inválida (400). Verifique se o ID de usuário está correto.';
        }
        
        message.reply(`❌ Ocorreu um erro: ${errorMessage}\n\nO que deseja fazer agora? Digite *MENU* para ver as opções.`);
        return false;
    }
}


client.on('message', async message => {
    const whatsappId = message.from;
    const body = message.body.trim();
    const bodyLower = body.toLowerCase();
    
    const session = userSessionState[whatsappId];
    const userId = userMap[whatsappId];

    const greetings = ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'eai', 'opa', 'ei'];

    if (greetings.includes(bodyLower) && !userId) {
        await message.reply(
`Seja bem vindo(a) ao WhatsApp do FinanZas!
Para usufruir completamente da ferramenta, entre no site https://finanzas-dev.com.br
Realize o login/cadastro. No menu "Configurações", copie o seu "ID de Usuário (UID)".
Cole esse ID aqui no chat da seguinte forma: 

CONECTAR SEU_ID_AQUI`
        );
        userSessionState[whatsappId] = 'awaiting_connect';
        return;
    }

    if (body.toUpperCase().startsWith('CONECTAR ')) {
        const finanzasUserId = body.substring(9).trim();

        if (finanzasUserId.length < 5 || !/^[a-zA-Z0-9]{20,}$/.test(finanzasUserId)) {
            await message.reply('❌ ID de usuário inválido. Verifique o ID no site (Menu > Configurações) e tente novamente. Ex: CONECTAR A1B2C3D4E5...');
            userSessionState[whatsappId] = 'awaiting_connect';
            return;
        }

        userMap[whatsappId] = finanzasUserId;
        userSessionState[whatsappId] = 'in_menu'; 
        await message.reply(`✅ Pronto, agora você está autenticado! \n\nDigite *MENU* para ver as opções.`);
        return;
    }
    
    if (!userId) {
        await message.reply('Olá! Parece que você ainda não se conectou. Envie "oi" ou "olá" para ver as instruções de como começar.');
        return;
    }

    if (bodyLower === 'menu' || bodyLower === 'ajuda') {
        await message.reply(
`*Menu Principal*
Digite o *número* da opção desejada:

1️⃣ - Registrar Entrada
2️⃣ - Registrar Saída
3️⃣ - Resumo Financeiro
4️⃣ - Desconectar`
        );
        userSessionState[whatsappId] = 'in_menu';
        return;
    }

    if (session === 'in_menu') {
        switch (body) {
            case '1':
                userSessionState[whatsappId] = 'awaiting_entrada';
                await message.reply('Ok, vamos registrar uma *Entrada*.\n\nPor favor, digite o *valor* e a *descrição*.\n(Ex: 2000 salário)');
                return;
            case '2':
                userSessionState[whatsappId] = 'awaiting_saida';
                await message.reply('Ok, vamos registrar uma *Saída*.\n\nPor favor, digite o *valor* e a *descrição*.\n(Ex: 45 almoço)');
                return;
            case '3':
                // IMPLEMENTAÇÃO DO RESUMO FINANCEIRO
                userSessionState[whatsappId] = 'fetching_summary';
                await message.reply('Buscando seu resumo financeiro... Aguarde um momento.');
                const success = await getFinancialSummary(message);
                
                // Retorna ao menu principal após a operação
                userSessionState[whatsappId] = 'in_menu';
                await message.reply('O que deseja fazer agora? Digite *MENU* para ver as opções.');
                return;
            case '4':
                delete userMap[whatsappId];
                delete userSessionState[whatsappId];
                await message.reply('Sessão encerrada. Você foi desconectado. 👋\n\nPara usar o bot novamente, envie "oi".');
                return;
            default:
                await message.reply('Opção inválida. Por favor, digite *MENU* para ver as opções novamente.');
                return;
        }
    }

    if (session === 'awaiting_entrada') {
        const textToProcess = 'entrada ' + body;

        const success = await processTransaction(message, textToProcess);

        if (success) {
            userSessionState[whatsappId] = 'in_menu';
            await message.reply('O que deseja fazer agora? Digite *MENU* para ver as opções.');
        }
        
        return;
    }

    if (session === 'awaiting_saida') {
        const textToProcess = 'saida ' + body;
        const success = await processTransaction(message, textToProcess);

        if (success) {
            userSessionState[whatsappId] = 'in_menu'; 
            await message.reply('O que deseja fazer agora? Digite *MENU* para ver as opções.');
        }
        return;
    }

    await message.reply('Comando não reconhecido. Digite *MENU* para ver a lista de opções.');
});


client.initialize();


app.use(express.json());

app.listen(PORT, () => {
    
});