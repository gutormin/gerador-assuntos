// ═══════════════════════════════════════════════════════════════
//  CONFIGURAÇÃO FIREBASE
// ═══════════════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey:            "AIzaSyC1iKoTVmwb47pJhVkrLyuLLPrwGujTx-A",
  authDomain:        "gerador-de-assuntos.firebaseapp.com",
  databaseURL:       "https://gerador-de-assuntos-default-rtdb.firebaseio.com",
  projectId:         "gerador-de-assuntos",
  storageBucket:     "gerador-de-assuntos.firebasestorage.app",
  messagingSenderId: "660561361564",
  appId:             "1:660561361564:web:1c790461998d2ed35e0b59",
  measurementId:     "G-8K0EEXN066"
};

// ── Inicializar Firebase ──────────────────────────────────────
let db, assuntosRef, auth;

try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    assuntosRef = db.collection("assuntos");
    auth = firebase.auth();

    auth.signInAnonymously().catch((err) => {
        console.error("❌ Erro na autenticação anônima:", err);
        mostrarErroConfig();
    });

    console.log("✅ Firebase inicializado com sucesso!");
} catch (error) {
    console.error("❌ Erro ao inicializar Firebase:", error);
    mostrarErroConfig();
}

// Exibe o banner de erro de configuração (oculto por padrão)
function mostrarErroConfig() {
    const el = document.getElementById("config-error");
    if (el) el.classList.add("show");
}

// ── Estado global ─────────────────────────────────────────────
let editandoId      = null;
let tagsAtivas      = [];           // palavras-chave como array de chips
let categoriasCache = new Set();    // categorias conhecidas (para datalist)
let buscasRecentes  = [];           // últimas 5 buscas da sessão
let debounceTimer   = null;

// ── Limites de leitura do Firestore ───────────────────────────
const LIMITE_BUSCA = 200;
const LIMITE_LISTA = 100;

// ═══════════════════════════════════════════════════════════════
//  ABAS
// ═══════════════════════════════════════════════════════════════
function mudarAba(aba) {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    document.getElementById("tab-" + aba).classList.add("active");
    document.getElementById("panel-" + aba).classList.add("active");
}

// ═══════════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════════
function toast(msg, tipo = "success") {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.className = tipo === "error" ? "error show" : "show";
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ""; }, 3500);
}

// ═══════════════════════════════════════════════════════════════
//  SANITIZAÇÃO
// ═══════════════════════════════════════════════════════════════
function sanitize(str) {
    if (typeof str !== "string") return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// ═══════════════════════════════════════════════════════════════
//  CHIPS DE PALAVRAS-CHAVE
// ═══════════════════════════════════════════════════════════════
function renderChips() {
    const wrapper = document.getElementById("tags-wrapper");
    const input   = document.getElementById("tag-input");

    // Remove chips antigos (mantém o input)
    wrapper.querySelectorAll(".chip").forEach(c => c.remove());

    tagsAtivas.forEach((tag, i) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.innerHTML = `${sanitize(tag)}<button type="button" onclick="removerTag(${i})" title="Remover"><i class="fas fa-xmark"></i></button>`;
        wrapper.insertBefore(chip, input);
    });

    // Atualiza o campo hidden usado pelo salvarAssunto
    document.getElementById("palavras_chave").value = tagsAtivas.join(", ");

    // Placeholder dinâmico
    input.placeholder = tagsAtivas.length === 0
        ? "Digite e pressione Enter ou vírgula…"
        : "Adicionar mais…";
}

function adicionarTag(valor) {
    const limpo = valor.trim().replace(/,+$/, "").trim();
    if (!limpo) return;
    if (tagsAtivas.includes(limpo)) return; // sem duplicatas
    tagsAtivas.push(limpo);
    renderChips();
}

function removerTag(i) {
    tagsAtivas.splice(i, 1);
    renderChips();
}

function tagKeyDown(e) {
    const input = e.target;
    if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        adicionarTag(input.value);
        input.value = "";
    } else if (e.key === "Backspace" && input.value === "" && tagsAtivas.length > 0) {
        removerTag(tagsAtivas.length - 1);
    }
}

function tagInput(e) {
    // Suporte a colar texto com vírgulas
    const v = e.target.value;
    if (v.includes(",")) {
        v.split(",").forEach(p => adicionarTag(p));
        e.target.value = "";
    }
}

function limparChips() {
    tagsAtivas = [];
    renderChips();
    document.getElementById("tag-input").value = "";
}

// Preenche chips ao editar um assunto
function carregarChips(palavras) {
    tagsAtivas = [...palavras];
    renderChips();
}

// ═══════════════════════════════════════════════════════════════
//  DATALIST DE CATEGORIAS
// ═══════════════════════════════════════════════════════════════
function atualizarDatalist() {
    const dl = document.getElementById("categorias-list");
    if (!dl) return;
    dl.innerHTML = [...categoriasCache]
        .sort()
        .map(c => `<option value="${sanitize(c)}">`)
        .join("");
}

// ═══════════════════════════════════════════════════════════════
//  CONTADOR NO HEADER
// ═══════════════════════════════════════════════════════════════
function atualizarContador(n) {
    const el = document.getElementById("total-count");
    if (el) el.textContent = n;
    const lc = document.getElementById("lista-count");
    if (lc) lc.textContent = n + " cadastrado" + (n !== 1 ? "s" : "");
}

// ═══════════════════════════════════════════════════════════════
//  CADASTRAR / ATUALIZAR ASSUNTO
// ═══════════════════════════════════════════════════════════════
async function salvarAssunto() {
    const titulo    = document.getElementById("titulo").value.trim();
    const categoria = document.getElementById("categoria").value.trim();
    const descricao = document.getElementById("descricao").value.trim();

    if (!titulo) { toast("Preencha o título do assunto!", "error"); return; }
    if (tagsAtivas.length === 0) { toast("Adicione ao menos uma palavra-chave!", "error"); return; }

    const dados = {
        titulo,
        palavras_chave: tagsAtivas,
        categoria: categoria || "geral",
        descricao: descricao || "",
    };

    const btn = document.getElementById("btn-cadastrar");
    if (btn) btn.disabled = true;

    try {
        if (editandoId) {
            await assuntosRef.doc(editandoId).update({
                ...dados,
                data_atualizacao: firebase.firestore.FieldValue.serverTimestamp()
            });
            toast("Assunto atualizado com sucesso!");
            cancelarEdicao();
        } else {
            await assuntosRef.add({
                ...dados,
                data_cadastro: firebase.firestore.FieldValue.serverTimestamp()
            });
            toast("Assunto cadastrado com sucesso!");
        }
        limparFormulario();
        carregarAssuntosCadastrados();
    } catch (error) {
        console.error("Erro ao salvar:", error);
        toast("Erro ao salvar assunto!", "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

function limparFormulario() {
    document.getElementById("titulo").value = "";
    document.getElementById("categoria").value = "";
    document.getElementById("descricao").value = "";
    limparChips();
    editandoId = null;
    document.getElementById("btn-cadastrar").textContent = "Cadastrar";
}

async function removerAssunto(id, titulo) {
    if (!confirm(`Remover "${titulo}"?`)) return;
    try {
        await assuntosRef.doc(id).delete();
        toast("Assunto removido!");
        carregarAssuntosCadastrados();
    } catch (error) {
        console.error("Erro ao remover:", error);
        toast("Erro ao remover!", "error");
    }
}

async function editarAssunto(id) {
    try {
        const doc = await assuntosRef.doc(id).get();
        const dados = doc.data();
        document.getElementById("titulo").value = dados.titulo || "";
        document.getElementById("categoria").value = dados.categoria || "";
        document.getElementById("descricao").value = dados.descricao || "";
        carregarChips(dados.palavras_chave || []);
        editandoId = id;
        document.getElementById("btn-cadastrar").textContent = "Atualizar";
        mudarAba("gerenciar");
        document.getElementById("titulo").focus();
        document.getElementById("titulo").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
        console.error("Erro ao editar:", error);
        toast("Erro ao carregar assunto!", "error");
    }
}

function cancelarEdicao() {
    limparFormulario();
}

// ═══════════════════════════════════════════════════════════════
//  BUSCA
// ═══════════════════════════════════════════════════════════════
function buscar() {
    const termo = document.getElementById("busca").value.trim();
    if (!termo) {
        document.getElementById("resultados").innerHTML = "";
        return;
    }

    // Armazena buscas recentes
    if (!buscasRecentes.includes(termo)) {
        buscasRecentes.unshift(termo);
        if (buscasRecentes.length > 5) buscasRecentes.pop();
        atualizarBuscasRecentes();
    }

    const el = document.getElementById("resultados");
    el.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fas fa-circle-notch fa-spin"></i> Buscando…</div>';

    const palavrasBusca = termo.toLowerCase().split(/\s+/);

    assuntosRef
        .limit(LIMITE_BUSCA)
        .get()
        .then(snapshot => {
            const assuntos = [];
            snapshot.forEach(doc => {
                const a = doc.data();
                const titulo = (a.titulo || "").toLowerCase();
                const descricao = (a.descricao || "").toLowerCase();
                const palavras = (a.palavras_chave || []).map(p => p.toLowerCase());

                let relevancia = 0;
                palavrasBusca.forEach(b => {
                    if (titulo.includes(b)) relevancia += 40;
                    if (descricao.includes(b)) relevancia += 20;
                    if (palavras.some(p => p.includes(b))) relevancia += 30;
                });

                if (relevancia > 0) {
                    assuntos.push({
                        id: doc.id,
                        ...a,
                        relevancia: Math.min(relevancia, 100)
                    });
                }
            });

            assuntos.sort((a, b) => b.relevancia - a.relevancia);

            if (assuntos.length === 0) {
                el.innerHTML = `
                    <div class="empty">
                        <i class="fas fa-inbox"></i>
                        Nenhum resultado para "<strong>${sanitize(termo)}</strong>".
                        <button class="btn btn-primary" style="margin-top:12px;" onclick="irParaCadastro('${sanitize(termo).replace(/'/g, "\\'")}')">
                            Criar novo assunto
                        </button>
                    </div>`;
                return;
            }

            renderResultados(assuntos, palavrasBusca);
        })
        .catch(error => {
            console.error("Erro na busca:", error);
            el.innerHTML = `<div class="empty" style="color:var(--danger)"><i class="fas fa-circle-exclamation"></i>Erro na busca</div>`;
        });
}

function atualizarBuscasRecentes() {
    const el = document.getElementById("buscas-recentes");
    if (!el) return;
    if (buscasRecentes.length === 0) {
        el.innerHTML = "";
        return;
    }
    el.innerHTML = "📌 RECENTES: " + buscasRecentes.map(t => 
        `<button class="btn-tag-recent" onclick="document.getElementById('busca').value='${sanitize(t).replace(/"/g, '&quot;')}'; buscar()">${sanitize(t)}</button>`
    ).join("");
}

function renderResultados(assuntos, palavrasBusca = []) {
    const el = document.getElementById("resultados");
    if (assuntos.length === 0) {
        el.innerHTML = "<div class='empty'>Nenhum resultado.</div>";
        return;
    }

    let html = `<div style="margin-bottom:10px;color:var(--ink-muted);">${assuntos.length} assunto(s) encontrado(s) — ordenado por relevância</div>`;

    assuntos.forEach((a, idx) => {
        const tags = (a.palavras_chave || []).map(t => {
            const isMatch = palavrasBusca.some(b =>
                t.toLowerCase().includes(b) || b.includes(t.toLowerCase())
            );
            return `<span class="tag ${isMatch ? 'highlight' : ''}">${sanitize(t)}</span>`;
        }).join("");

        const temDesc = !!(a.descricao && a.descricao.trim());

        html += `
        <div class="result-item" id="result-${idx}">
            <div class="result-top">
                <h3>${sanitize(a.titulo)}</h3>
                <span class="relevance-badge ${a.relevancia >= 60 ? 'high' : ''}">${a.relevancia}%</span>
            </div>
            <div class="result-meta">
                <i class="fas fa-folder-open" style="margin-right:4px;opacity:.6"></i>${sanitize(a.categoria || "geral")}
            </div>
            <div class="tags">${tags}</div>
            ${temDesc ? `<div class="result-desc">${sanitize(a.descricao)}</div>` : ''}
            <div class="result-actions">
                <button class="btn btn-primary btn-sm" data-action="usar" data-descricao="${sanitize(a.descricao).replace(/"/g, '&quot;')}">
                    <i class="fas fa-copy"></i> Usar este assunto
                </button>
                <button class="btn btn-ghost btn-icon" data-action="editar" data-id="${sanitize(a.id)}" title="Editar">
                    <i class="fas fa-pencil"></i>
                </button>
                ${temDesc ? `<button class="btn-expand" data-action="expandir" data-idx="${idx}">
                    <i class="fas fa-chevron-down"></i> detalhes
                </button>` : ''}
            </div>
        </div>`;
    });

    el.innerHTML = html;

    // Event delegation — evita problemas com caracteres especiais no onclick inline
    el.querySelectorAll("[data-action]").forEach(btn => {
        btn.addEventListener("click", () => {
            const action = btn.dataset.action;
            if (action === "usar") usarAssunto(btn.dataset.descricao);
            if (action === "editar") editarAssunto(btn.dataset.id);
            if (action === "expandir") {
                const item = document.getElementById("result-" + btn.dataset.idx);
                item.classList.toggle("expanded");
                const expandido = item.classList.contains("expanded");
                btn.innerHTML = expandido
                    ? '<i class="fas fa-chevron-up"></i> ocultar'
                    : '<i class="fas fa-chevron-down"></i> detalhes';
            }
        });
    });
}

// ── Ir para cadastro pré-preenchido quando não acha resultado ──
function irParaCadastro(termoBusca) {
    mudarAba("gerenciar");
    setTimeout(() => {
        document.getElementById("titulo").value = termoBusca;
        document.getElementById("titulo").focus();
        document.getElementById("titulo").scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
}

// ═══════════════════════════════════════════════════════════════
//  USAR ASSUNTO (COPIAR DESCRIÇÃO)
// ═══════════════════════════════════════════════════════════════
function usarAssunto(descricao) {
    if (!descricao) {
        toast("Sem descrição para copiar!", "error");
        return;
    }
    navigator.clipboard?.writeText(descricao).catch(() => {});
    toast(`✓ Descrição copiada para a área de transferência!`);
}

// ═══════════════════════════════════════════════════════════════
//  CARREGAR LISTA DE ASSUNTOS CADASTRADOS
// ═══════════════════════════════════════════════════════════════
// ── Lista de cadastrados: cache local p/ filtro + agrupamento ──
let listaCache = []; // [{id, titulo, categoria, palavras_chave}]

function renderItemLista(item) {
    return `
    <li id="li-${sanitize(item.id)}">
        <div class="info">
            <strong>${sanitize(item.titulo)}</strong>
            <small>${(item.palavras_chave || []).map(sanitize).join(", ")}</small>
        </div>
        <div class="actions">
            <button class="btn btn-ghost btn-icon" data-action="editar" data-id="${sanitize(item.id)}" title="Editar">
                <i class="fas fa-pencil"></i>
            </button>
            <button class="btn btn-danger btn-icon" data-action="remover" data-id="${sanitize(item.id)}" data-titulo="${sanitize(item.titulo).replace(/"/g, '&quot;')}" title="Remover">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    </li>`;
}

function renderListaAgrupada(itens) {
    const el = document.getElementById("lista_assuntos");

    if (itens.length === 0) {
        el.innerHTML = `<div class="empty"><i class="fas fa-inbox"></i>Nenhum assunto encontrado.</div>`;
        return;
    }

    // Agrupa por categoria
    const grupos = {};
    itens.forEach(item => {
        const cat = item.categoria || "geral";
        if (!grupos[cat]) grupos[cat] = [];
        grupos[cat].push(item);
    });

    let html = "";
    Object.keys(grupos).sort().forEach(cat => {
        html += `<div class="categoria-group-title">${sanitize(cat)} (${grupos[cat].length})</div>`;
        html += '<ul class="assunto-list">';
        grupos[cat].forEach(item => { html += renderItemLista(item); });
        html += '</ul>';
    });

    el.innerHTML = html;

    // Event delegation para editar/remover
    el.querySelectorAll("[data-action]").forEach(btn => {
        btn.addEventListener("click", () => {
            const action = btn.dataset.action;
            if (action === "editar") editarAssunto(btn.dataset.id);
            if (action === "remover") removerAssunto(btn.dataset.id, btn.dataset.titulo);
        });
    });
}

function filtrarLista() {
    const termo = (document.getElementById("filtro-lista-input")?.value || "").toLowerCase().trim();
    if (!termo) {
        renderListaAgrupada(listaCache);
        return;
    }
    const filtrados = listaCache.filter(item =>
        (item.titulo || "").toLowerCase().includes(termo) ||
        (item.categoria || "").toLowerCase().includes(termo) ||
        (item.palavras_chave || []).some(p => p.toLowerCase().includes(termo))
    );
    renderListaAgrupada(filtrados);
}

function processarSnapshot(snapshot) {
    listaCache = [];
    categoriasCache.clear();
    snapshot.forEach(doc => {
        const a = doc.data();
        listaCache.push({ id: doc.id, ...a });
        if (a.categoria) categoriasCache.add(a.categoria);
    });
    atualizarContador(listaCache.length);
    atualizarDatalist();
    filtrarLista(); // respeita filtro ativo, ou mostra tudo
}

async function carregarAssuntosCadastrados() {
    const el = document.getElementById("lista_assuntos");

    try {
        const snapshot = await assuntosRef
            .orderBy("data_cadastro", "desc")
            .limit(LIMITE_LISTA)
            .get();
        processarSnapshot(snapshot);
    } catch (error) {
        console.error("Erro ao carregar:", error);
        try {
            const snapshot = await assuntosRef.limit(LIMITE_LISTA).get();
            processarSnapshot(snapshot);
        } catch (e2) {
            el.innerHTML = `<div class="empty" style="color:var(--danger)"><i class="fas fa-circle-exclamation"></i>Erro ao carregar. Verifique o Firebase.</div>`;
        }
    }
}

// ═══════════════════════════════════════════════════════════════
//  FUNÇÕES DE CONSOLE (teste/utilitários)
// ═══════════════════════════════════════════════════════════════
async function cadastrarAssuntoTeste() {
    const exemplos = [
        { titulo: "Solicitação de documentos pessoais", palavras_chave: ["documento","certidão","cópia","RG","CPF","comprovante"], categoria: "administrativo", descricao: "Para solicitar documentos pessoais como RG, CPF, certidões" },
        { titulo: "Agendamento de reunião", palavras_chave: ["reunião","agendar","data","horário","audiência","encontro"], categoria: "administrativo", descricao: "Para solicitar agendamento de reuniões ou audiências" },
        { titulo: "Solicitação de recursos financeiros", palavras_chave: ["dinheiro","recursos","financiamento","investimento","fundos","pagamento"], categoria: "financeiro", descricao: "Para solicitar recursos financeiros ou financiamentos" },
        { titulo: "Autorização para viagem", palavras_chave: ["viagem","deslocamento","autorização","passagem","transporte","missão"], categoria: "administrativo", descricao: "Para solicitar autorização para viagens ou deslocamentos" },
        { titulo: "Renovação de contrato", palavras_chave: ["contrato","renovar","prorrogação","vigência","término","extensão"], categoria: "jurídico", descricao: "Para solicitar renovação ou prorrogação de contratos" }
    ];

    for (const a of exemplos) {
        try {
            await assuntosRef.add({ ...a, data_cadastro: firebase.firestore.FieldValue.serverTimestamp() });
            console.log(`✅ Cadastrado: ${a.titulo}`);
        } catch (e) {
            console.error(`❌ Erro em "${a.titulo}":`, e);
        }
    }

    toast("5 assuntos de exemplo cadastrados!");
    carregarAssuntosCadastrados();
}

async function listarTodosAssuntos() {
    try {
        const snapshot = await assuntosRef.get();
        console.group("=== ASSUNTOS CADASTRADOS ===");
        snapshot.forEach(doc => { console.log(`ID: ${doc.id}`); console.table(doc.data()); });
        console.log(`Total: ${snapshot.size} assunto(s)`);
        console.groupEnd();
    } catch (e) {
        console.error("Erro ao listar:", e);
    }
}

// ═══════════════════════════════════════════════════════════════
//  INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════
window.addEventListener("load", () => {
    console.log("🟢 Sistema Gerador de Assuntos carregado!");
    console.log("   cadastrarAssuntoTeste()  — insere 5 assuntos de exemplo");
    console.log("   listarTodosAssuntos()    — lista todos no console");

    // Atalho de teclado: "/" foca a busca
    document.addEventListener("keydown", (e) => {
        if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
            e.preventDefault();
            mudarAba("buscar");
            document.getElementById("busca").focus();
        }
    });

    if (auth) {
        auth.onAuthStateChanged((user) => {
            if (user) carregarAssuntosCadastrados();
        });
    } else {
        carregarAssuntosCadastrados();
    }
});
