// ═══════════════════════════════════════════════════════════════
//  CONFIGURAÇÃO FIREBASE
// ═══════════════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey:            "AIzaSyApOPpXrpN1-tnM7xvKgNlaKI_UA_s-D60",
  authDomain:        "gerador-de-assuntos-9bfe4.firebaseapp.com",
  projectId:         "gerador-de-assuntos-9bfe4",
  storageBucket:     "gerador-de-assuntos-9bfe4.firebasestorage.app",
  messagingSenderId: "273319840643",
  appId:             "1:273319840643:web:4f1f2b6979c39e8c0a44b6",
  measurementId:     "G-5X8SSQRQ8S"
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
        toast("Erro de autenticação. Verifique se o login anônimo está ativo no Firebase.", "error");
    });

    console.log("✅ Firebase inicializado com sucesso!");
} catch (error) {
    console.error("❌ Erro ao inicializar Firebase:", error);
    toast("Configure o Firebase primeiro! Veja o aviso na página.", "error");
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
            limparFormulario();
        }

        carregarAssuntosCadastrados();
    } catch (error) {
        console.error("Erro ao salvar:", error);
        toast("Erro ao salvar assunto. Verifique o Firebase.", "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

function limparFormulario() {
    document.getElementById("titulo").value    = "";
    document.getElementById("categoria").value = "";
    document.getElementById("descricao").value = "";
    limparChips();
}

// ═══════════════════════════════════════════════════════════════
//  EDITAR ASSUNTO
// ═══════════════════════════════════════════════════════════════
async function editarAssunto(id) {
    if (!id) return;

    try {
        const doc = await assuntosRef.doc(id).get();
        if (!doc.exists) { toast("Assunto não encontrado.", "error"); return; }

        const a = doc.data();
        document.getElementById("titulo").value    = a.titulo || "";
        document.getElementById("categoria").value = a.categoria || "";
        document.getElementById("descricao").value = a.descricao || "";
        carregarChips(a.palavras_chave || []);

        editandoId = id;
        document.getElementById("btn-label").textContent = "Atualizar Assunto";
        document.getElementById("edit-mode-banner").classList.add("show");

        // Muda para aba gerenciar e rola até o formulário
        mudarAba("gerenciar");
        setTimeout(() => {
            document.getElementById("titulo").scrollIntoView({ behavior: "smooth", block: "center" });
            document.getElementById("titulo").focus();
        }, 100);
    } catch (error) {
        console.error("Erro ao carregar assunto para edição:", error);
        toast("Erro ao carregar assunto.", "error");
    }
}

function cancelarEdicao() {
    editandoId = null;
    document.getElementById("btn-label").textContent = "Cadastrar Assunto";
    document.getElementById("edit-mode-banner").classList.remove("show");
    limparFormulario();
}

// ═══════════════════════════════════════════════════════════════
//  REMOVER ASSUNTO
// ═══════════════════════════════════════════════════════════════
function removerAssunto(id, titulo) {
    const li = document.getElementById("li-" + id);
    if (!li) return;

    li.innerHTML = `
        <div class="info" style="color:var(--danger);font-size:.88rem;">
            <strong>Remover "${sanitize(titulo)}"?</strong>
        </div>
        <div class="actions">
            <button class="btn btn-danger btn-sm" onclick="confirmarRemocao('${sanitize(id)}')">
                <i class="fas fa-trash"></i> Sim
            </button>
            <button class="btn btn-ghost btn-sm" onclick="carregarAssuntosCadastrados()">
                Cancelar
            </button>
        </div>
    `;
}

async function confirmarRemocao(id) {
    try {
        await assuntosRef.doc(id).delete();
        toast("Assunto removido.");
        carregarAssuntosCadastrados();
    } catch (error) {
        console.error("Erro ao remover:", error);
        toast("Erro ao remover assunto.", "error");
    }
}

// ═══════════════════════════════════════════════════════════════
//  BUSCA — debounce para tempo real
// ═══════════════════════════════════════════════════════════════
function buscarDebounce() {
    clearTimeout(debounceTimer);
    const v = document.getElementById("busca").value.trim();
    if (v.length < 3) return; // só busca a partir de 3 letras
    debounceTimer = setTimeout(() => buscarAssuntos(), 400);
}

async function buscarAssuntos() {
    const textoBusca = document.getElementById("busca").value.trim();

    if (!textoBusca) {
        toast("Digite alguma palavra para buscar!", "error");
        return;
    }

    const palavrasBusca = textoBusca
        .toLowerCase()
        .split(/\s+/)
        .map(p => p.trim())
        .filter(p => p.length >= 2);

    if (palavrasBusca.length === 0) {
        toast("Digite palavras com pelo menos 2 letras.", "error");
        return;
    }

    // Salva na lista de buscas recentes
    salvarBuscaRecente(textoBusca);

    const el = document.getElementById("resultados");
    el.innerHTML = `<div class="empty"><i class="fas fa-spinner fa-spin"></i>Buscando<span class="loading-dots"></span></div>`;

    try {
        const snapshot = await assuntosRef.limit(LIMITE_BUSCA).get();
        const resultados = [];

        snapshot.forEach(doc => {
            const assunto = doc.data();
            const relevancia = calcularRelevancia(assunto.palavras_chave || [], palavrasBusca);
            if (relevancia > 0) {
                resultados.push({ id: doc.id, ...assunto, relevancia });
            }
        });

        resultados.sort((a, b) => b.relevancia - a.relevancia);
        mostrarResultados(resultados, palavrasBusca, textoBusca);
    } catch (error) {
        console.error("Erro na busca:", error);
        el.innerHTML = `<div class="empty" style="color:var(--danger)"><i class="fas fa-circle-exclamation"></i>Erro ao buscar. Verifique o Firebase.</div>`;
    }
}

// ═══════════════════════════════════════════════════════════════
//  BUSCAS RECENTES
// ═══════════════════════════════════════════════════════════════
function salvarBuscaRecente(termo) {
    buscasRecentes = [termo, ...buscasRecentes.filter(t => t !== termo)].slice(0, 5);
    renderBuscasRecentes();
}

function renderBuscasRecentes() {
    const container = document.getElementById("recent-searches");
    const chips     = document.getElementById("recent-chips");
    if (!container || !chips) return;

    if (buscasRecentes.length === 0) {
        container.style.display = "none";
        return;
    }

    container.style.display = "flex";
    chips.innerHTML = buscasRecentes.map(t =>
        `<span class="recent-chip" onclick="usarBuscaRecente(${JSON.stringify(t)})">${sanitize(t)}</span>`
    ).join("");
}

function usarBuscaRecente(termo) {
    document.getElementById("busca").value = termo;
    buscarAssuntos();
}

// ═══════════════════════════════════════════════════════════════
//  ALGORITMO DE RELEVÂNCIA
// ═══════════════════════════════════════════════════════════════
function calcularRelevancia(palavrasAssunto, palavrasBusca) {
    if (!palavrasAssunto || palavrasAssunto.length === 0) return 0;

    let pontos = 0;
    const palavrasLower = palavrasAssunto.map(p => p.toLowerCase());

    for (const busca of palavrasBusca) {
        for (const palavra of palavrasLower) {
            if (palavra === busca) {
                pontos += 4;
            } else if (palavra.includes(busca) || busca.includes(palavra)) {
                pontos += 2;
            } else if (palavra.length >= 3 && busca.length >= 3 &&
                       palavra.substring(0, 3) === busca.substring(0, 3)) {
                pontos += 1;
            }
        }
    }

    const maxPontos = palavrasBusca.length * palavrasAssunto.length * 4;
    return maxPontos > 0 ? Math.min(100, Math.round((pontos / maxPontos) * 100)) : 0;
}

// ═══════════════════════════════════════════════════════════════
//  RENDERIZAR RESULTADOS
// ═══════════════════════════════════════════════════════════════
function mostrarResultados(assuntos, palavrasBusca, termoBusca) {
    const el = document.getElementById("resultados");

    if (assuntos.length === 0) {
        el.innerHTML = `
            <div class="empty-cta">
                <i class="fas fa-face-frown-open"></i>
                Nenhum assunto encontrado para <span class="search-term">"${sanitize(termoBusca)}"</span>
                <br><small style="color:var(--ink-muted)">Que tal cadastrar esse assunto agora?</small>
                <br>
                <button class="btn btn-primary btn-sm" onclick="irParaCadastro(${JSON.stringify(termoBusca)})">
                    <i class="fas fa-plus"></i> Cadastrar "${sanitize(termoBusca)}"
                </button>
            </div>`;
        return;
    }

    let html = `<p style="font-size:.82rem;color:var(--ink-muted);margin-bottom:14px;">
        ${assuntos.length} assunto(s) encontrado(s) — ordenado por relevância
    </p>`;

    assuntos.forEach(a => {
        const tags = (a.palavras_chave || []).map(t => {
            const isMatch = palavrasBusca.some(b =>
                t.toLowerCase().includes(b) || b.includes(t.toLowerCase())
            );
            return `<span class="tag ${isMatch ? 'highlight' : ''}">${sanitize(t)}</span>`;
        }).join("");

        html += `
        <div class="result-item">
            <h3>${sanitize(a.titulo)}</h3>
            <div class="result-meta">
                <i class="fas fa-folder-open" style="margin-right:4px;opacity:.6"></i>${sanitize(a.categoria || "geral")}
                ${a.descricao ? ` &nbsp;·&nbsp; ${sanitize(a.descricao).substring(0, 80)}${a.descricao.length > 80 ? '…' : ''}` : ''}
            </div>
            <div class="tags">${tags}</div>
            <div class="relevance-label">Relevância: ${a.relevancia}%</div>
            <div class="relevance-bar">
                <div class="relevance-fill" style="width:${a.relevancia}%"></div>
            </div>
            <div class="result-actions">
                <button class="btn btn-primary btn-sm" onclick="usarAssunto(${JSON.stringify(a.titulo)})">
                    <i class="fas fa-check"></i> Usar este assunto
                </button>
                <button class="btn btn-outline btn-sm" onclick="editarAssunto(${JSON.stringify(a.id)})">
                    <i class="fas fa-pencil"></i> Editar
                </button>
            </div>
        </div>`;
    });

    el.innerHTML = html;
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
//  USAR ASSUNTO
// ═══════════════════════════════════════════════════════════════
function usarAssunto(titulo) {
    navigator.clipboard?.writeText(titulo).catch(() => {});
    toast(`✓ "${titulo}" copiado para a área de transferência!`);
}

// ═══════════════════════════════════════════════════════════════
//  CARREGAR LISTA DE ASSUNTOS CADASTRADOS
// ═══════════════════════════════════════════════════════════════
function renderItemLista(doc) {
    const a = doc.data();
    return `
    <li id="li-${sanitize(doc.id)}">
        <div class="info">
            <strong>${sanitize(a.titulo)}</strong>
            <small>${sanitize(a.categoria || "geral")} &nbsp;·&nbsp; ${(a.palavras_chave || []).map(sanitize).join(", ")}</small>
        </div>
        <div class="actions">
            <button class="btn btn-outline btn-sm" onclick="editarAssunto(${JSON.stringify(doc.id)})">
                <i class="fas fa-pencil"></i>
            </button>
            <button class="btn btn-danger btn-sm" onclick="removerAssunto(${JSON.stringify(doc.id)}, ${JSON.stringify(a.titulo)})">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    </li>`;
}

function renderLista(snapshot, el) {
    if (snapshot.empty) {
        el.innerHTML = `<div class="empty"><i class="fas fa-inbox"></i>Nenhum assunto cadastrado ainda.</div>`;
        atualizarContador(0);
        return;
    }
    let html = '<ul class="assunto-list">';
    snapshot.forEach(doc => {
        html += renderItemLista(doc);
        // Coleta categorias para o datalist
        const cat = doc.data().categoria;
        if (cat) categoriasCache.add(cat);
    });
    html += '</ul>';
    el.innerHTML = html;
    atualizarContador(snapshot.size);
    atualizarDatalist();
}

async function carregarAssuntosCadastrados() {
    const el = document.getElementById("lista_assuntos");

    try {
        const snapshot = await assuntosRef
            .orderBy("data_cadastro", "desc")
            .limit(LIMITE_LISTA)
            .get();
        renderLista(snapshot, el);
    } catch (error) {
        console.error("Erro ao carregar:", error);
        try {
            const snapshot = await assuntosRef.limit(LIMITE_LISTA).get();
            renderLista(snapshot, el);
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

    if (auth) {
        auth.onAuthStateChanged((user) => {
            if (user) carregarAssuntosCadastrados();
        });
    } else {
        carregarAssuntosCadastrados();
    }
});
