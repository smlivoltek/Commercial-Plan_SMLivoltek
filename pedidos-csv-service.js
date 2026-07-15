// ═══════════════════════════════════════════════════════════════
// PEDIDOS-CSV-SERVICE.JS — mesma fonte do Painel de Pedidos (Airtable)
// ═══════════════════════════════════════════════════════════════
const PEDIDOS_CSV_URL = 'https://raw.githubusercontent.com/smlivoltek/Pedidos-Livoltek/main/pedidos.csv';
const DIRETORIAS_CSV_URL = 'diretorias.csv'; // opcional — Vendedor;Diretoria. Se não existir, cai no mapa fixo abaixo.

const KAM_TO_DIRETORIA_FIXO = {
    'Leonardo Dib': 'Distribution', 'Marcelo Leite': 'Distribution', 'Tainara': 'Distribution',
    'Kelly Li': 'Distribution', 'Mateus Armando': 'Distribution',
    'Anna Julia': 'E-Mobility', 'Beatriz Sales': 'E-Mobility', 'Kariny Maciel': 'E-Mobility', 'Vinicio Carrara': 'E-Mobility',
    'Flavio Pimenta': 'Projects E-mobility', 'Bruno Reis': 'Projects E-mobility', 'Felipe Hanke': 'Projects E-mobility',
    'Wilton Moura': 'Projects & Bids', 'Mateus Gomes': 'Projects & Bids', 'Thiago Gomes': 'Projects & Bids',
    'Marcos Petroline': 'Projects & Bids', 'Ana Netildes': 'Projects & Bids',
    'Fabiam Lourenco': 'Eletra', 'Samir Sarquis': 'Eletra', 'Vinicius Valadão': 'Eletra', 'Vinicius Ferreira': 'Eletra',
    'Camila Mendoza': 'Hexing', 'Flora': 'Hexing',
};

let MAPA_DIRETORIAS_CSV = null; // preenchido por carregarMapaDiretorias(), se o arquivo existir

async function carregarMapaDiretorias() {
    try {
        const texto = await fetchTextoLatin1(DIRETORIAS_CSV_URL);
        const linhas = texto.trim().split('\n').filter(l => l.trim());
        const sep = linhas[0].includes(';') ? ';' : ',';
        const mapa = {};
        linhas.slice(1).forEach(l => {
            const [vendedor, diretoria] = l.split(sep).map(c => (c||'').trim());
            if (vendedor && diretoria) mapa[vendedor] = diretoria;
        });
        MAPA_DIRETORIAS_CSV = mapa;
        console.log(`📘 diretorias.csv carregado: ${Object.keys(mapa).length} vendedores mapeados`);
    } catch (e) {
        console.warn('⚠ data/diretorias.csv não encontrado — usando mapa fixo no código como reserva.');
        MAPA_DIRETORIAS_CSV = null;
    }
}

function getDiretoria(kamNome) {
    if (!kamNome) return 'Não mapeado';
    const mapa = MAPA_DIRETORIAS_CSV || KAM_TO_DIRETORIA_FIXO;
    if (mapa[kamNome]) return mapa[kamNome];
    const kamLower = kamNome.toLowerCase();
    for (const [nome, dir] of Object.entries(mapa)) {
        if (kamLower.includes(nome.toLowerCase()) || nome.toLowerCase().includes(kamLower)) return dir;
    }
    return 'Não mapeado';
}

function fetchTextoLatin1(url) {
    return fetch(url).then(resp => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.arrayBuffer();
    }).then(buffer => new TextDecoder('windows-1252').decode(buffer));
}

function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length === 0) return [];
    const header = lines[0];
    const separator = header.includes(';') ? ';' : ',';
    const headers = lines[0].split(separator).map(h => h.trim().toLowerCase());

    const colMap = {
        po: headers.findIndex(h => h.includes('po') && h.includes('relacionado')),
        customer: headers.findIndex(h => h.includes('customer') || h.includes('cliente')),
        kam: headers.findIndex(h => h === 'kam'),
        dataReceb: headers.findIndex(h => h.includes('data pedido recebido')),
        dataCompl: headers.findIndex(h => h.includes('data pedido completo')),
        dataEnvio: headers.findIndex(h => h.includes('data envio faturamento')),
        warehouse: headers.findIndex(h => h.includes('warehouse')),
        valor: headers.findIndex(h => h.includes('valor') && h.includes('total')),
    };

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const cols = line.split(separator);
        rows.push({
            po: cols[colMap.po]?.trim() || '',
            customer: cols[colMap.customer]?.trim() || '',
            kam: cols[colMap.kam]?.trim() || '',
            dataReceb: cols[colMap.dataReceb]?.trim() || '',
            dataCompl: cols[colMap.dataCompl]?.trim() || '',
            dataEnvio: cols[colMap.dataEnvio]?.trim() || '',
            warehouse: cols[colMap.warehouse]?.trim() || '',
            valor: cols[colMap.valor]?.trim() || '0',
        });
    }
    return rows;
}

function calcDaysBetween(d1, d2) {
    if (!d1 || !d2) return '';
    try {
        const [dd1, mm1, yy1] = d1.split('/');
        const [dd2, mm2, yy2] = d2.split('/');
        return Math.ceil(Math.abs(new Date(yy2, mm2 - 1, dd2) - new Date(yy1, mm1 - 1, dd1)) / 86400000);
    } catch (e) { return ''; }
}

function extrairAnoMes(dataStr) {
    if (!dataStr) return { ano: null, mes: null };
    const partes = dataStr.split('/');
    if (partes.length !== 3) return { ano: null, mes: null };
    return { ano: parseInt(partes[2]), mes: parseInt(partes[1]) };
}

// Aceita "R$ 12.345,67", "12345.67", "12345,67" etc.
function parseValorBR(valorStr) {
    if (!valorStr) return 0;
    let s = String(valorStr).replace(/[^\d,.-]/g, '').trim();
    if (!s) return 0;
    if (s.includes(',') && s.includes('.')) {
        // formato BR: 12.345,67 → remove milhar, troca vírgula por ponto
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
        s = s.replace(',', '.');
    }
    return parseFloat(s) || 0;
}

async function carregarPedidos() {
    await carregarMapaDiretorias();
    const texto = await fetchTextoLatin1(PEDIDOS_CSV_URL);
    const rows = parseCSV(texto);
    const seen = new Set();
    const valoresPorPO = {}; // pra validar consistência do valor entre linhas do mesmo PO
    const pedidos = [];

    rows.forEach(row => {
        if (!row.po || !row.po.startsWith('LIV')) return;
        valoresPorPO[row.po] = valoresPorPO[row.po] || [];
        valoresPorPO[row.po].push(parseValorBR(row.valor));
    });

    const posComValorInconsistente = Object.entries(valoresPorPO)
        .filter(([po, vals]) => Math.max(...vals) - Math.min(...vals) > 0.01)
        .map(([po]) => po);

    if (posComValorInconsistente.length > 0) {
        console.warn(`⚠ ${posComValorInconsistente.length} PO(s) com valor diferente entre linhas — a coluna pode ser valor por produto, não por pedido:`, posComValorInconsistente.slice(0,10));
    }

    for (const row of rows) {
        const po = row.po;
        if (!po || !po.startsWith('LIV') || seen.has(po)) continue;
        seen.add(po);

        const { dataReceb, dataCompl, dataEnvio } = row;
        let status = '';
        if (dataReceb && !dataCompl) status = 'PENDÊNCIA DO VENDEDOR';
        else if (dataReceb && dataCompl && !dataEnvio) status = 'EM ANÁLISE (SM)';
        else if (dataReceb && dataCompl && dataEnvio) status = 'ENVIADO PARA FATURAMENTO (PD)';

        const { ano, mes } = extrairAnoMes(dataReceb);

        pedidos.push({
            kam: row.kam, po, cliente: row.customer,
            dataReceb, dataCompl, dataEnvio,
            slaComplEnvio: calcDaysBetween(dataCompl, dataEnvio),
            status, warehouse: row.warehouse,
            diretoria: getDiretoria(row.kam),
            valor: parseValorBR(row.valor),
            ano, mes
        });
    }
    return { pedidos, avisoValorInconsistente: posComValorInconsistente };
}

// ══════════════════════════════════════════════════════════════
// FATURADOS.CSV — fonte real de faturamento (NF), com valor por
// produto e por pedido. Colunas: Issue Date;Invoice;Boarding Location;
// Seller;PO;Operation;Customer;CNPJ/CPF;Product;Code;Qty;Tax (IPI);
// Net Unit Value.;Gross Unit Value.;Total without tax;Total with tax;
// Freight;Discount Amount;Status;Delivery Date;Notes;Cliente;Contrato
// ══════════════════════════════════════════════════════════════
const FATURADOS_CSV_URL = 'Faturados.csv'; // mesma pasta do index.html

function parseValorSimples(s){
    if (!s) return 0;
    return parseFloat(String(s).replace(',', '.').replace(/[^\d.-]/g,'')) || 0;
}

async function carregarFaturados(){
    await carregarMapaDiretorias();
    const texto = await fetchTextoLatin1(FATURADOS_CSV_URL);
    const linhasBrutas = texto.trim().split(/\r?\n/).filter(l => l.trim());
    const linhas = linhasBrutas.slice(1).map(l => l.split(';'));

    // Só considera Status "Current" — Re-invoiced/Rebilling ficam de fora pra não contar duplicado.
    // Se isso não bater com o que você espera, me avisa que ajusto o filtro.
    const itens = linhas
        .filter(c => c[4] && (c[18]||'').trim() === 'Current')
        .map(c => {
            const { ano, mes } = extrairAnoMes((c[0]||'').trim());
            return {
                dataEmissao: (c[0]||'').trim(),
                invoice: (c[1]||'').trim(),
                warehouse: (c[2]||'').trim(),
                seller: (c[3]||'').trim(),
                diretoria: getDiretoria((c[3]||'').trim()),
                po: (c[4]||'').trim(),
                cliente: (c[6]||'').trim(),
                produto: (c[8]||'').trim(),
                codigo: (c[9]||'').trim(),
                qtd: parseValorSimples(c[10]),
                valor: parseValorSimples(c[15]), // Total with tax
                status: (c[18]||'').trim(),
                contrato: (c[22]||'').trim(),
                ano, mes
            };
        });

    // Agregado por PO (soma as linhas de produto do mesmo pedido)
    const porPO = {};
    itens.forEach(it => {
        if (!porPO[it.po]) porPO[it.po] = { ...it, valor:0, qtd:0, itens:0 };
        porPO[it.po].valor += it.valor;
        porPO[it.po].qtd += it.qtd;
        porPO[it.po].itens += 1;
    });

    return { itens, pedidos: Object.values(porPO) };
}
