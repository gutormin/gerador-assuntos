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

let db, assuntosRef, auth;

try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    assuntosRef = db.collection("assuntos");
    auth = firebase.auth();
    auth.signInAnonymously().catch((err) => {
        console.error("Erro na autenticacao anonima:", err);
        mostrarErroConfig();
    });
    console.log("Firebase inicializado com sucesso!");
} catch (error) {
    console.error("Erro ao inicializar Firebase:", error);
    mostrarErroConfig();
}

function mostrarErroConfig() {
    const el = document.getElementById("config-error");
    if (el) el.classList.add("show");
}

// Estado global
let editandoId      = null;
let tagsAtivas      = [];
let categoriasCache = new Set();
let debounceTimer   = null;
let listaCache      = [];
let categoriaFiltro = null;

const LIMITE = 500;

// Dados pessoais (localStorage)
const LS_FAV = "ga_favoritos";
const LS_HIST = "ga_historico";
const LS_USOS = "ga_usos";

function lsGet(chave, padrao) {
    try { return JSON.parse(localStorage.getItem(chave)) || padrao; }
    catch { return padrao; }
}
function lsSet(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch {}
}

let favoritos = lsGet(LS_FAV, []);
let historico = lsGet(LS_HIST, []);
let usos      = lsGet(LS_USOS, {});

// NAVEGACAO
function irPara(tela) {
    document.querySelectorAll(".tela").forEach(t => t.classList.remove("ativa"));
    document.getElementById("tela-" + tela).classList.add("ativa");
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("ativo", b.dataset.tela === tela));
    if (tela === "buscar") {
        setTimeout(() => document.getElementById("busca")?.focus(), 100);
        renderInicio();
    }
    if (tela === "gerenciar") carregarAssuntos();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// TOAST
function toast(msg, tipo) {
    tipo = tipo || "success";
    const el = document.getElementById("toast");
    const icones = { success: "fa-circle-check", error: "fa-circle-exclamation", info: "fa-circle-info" };
    el.innerHTML = '<i class="fas ' + (icones[tipo] || icones.success) + '"></i> ' + msg;
    el.className = tipo + " show";
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = ""; }, 3200);
}

function sanitize(str) {
    if (typeof str !== "string") return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// CHIPS
function renderChips() {
    const wrapper = document.getElementById("tags-wrapper");
    const input   = document.getElementById("tag-input");
    wrapper.querySelectorAll(".chip").forEach(c => c.remove());
    tagsAtivas.forEach((tag, i) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.innerHTML = sanitize(tag) + '<button type="button" onclick="removerTag(' + i + ')" title="Remover"><i class="fas fa-xmark"></i></button>';
        wrapper.insertBefore(chip, input);
    });
    document.getElementById("palavras_chave").value = tagsAtivas.join(", ");
    input.placeholder = tagsAtivas.length === 0 ? "Digite e tecle Enter..." : "Mais uma...";
}
function adicionarTag(valor) {
    const limpo = valor.trim().replace(/,+$/, "").trim();
    if (!limpo || tagsAtivas.includes(limpo)) return;
    tagsAtivas.push(limpo);
    renderChips();
}
function removerTag(i) { tagsAtivas.splice(i, 1); renderChips(); }
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
    if (e.target.value.includes(",")) {
        e.target.value.split(",").forEach(p => adicionarTag(p));
        e.target.value = "";
    }
}
function limparChips() { tagsAtivas = []; renderChips(); document.getElementById("tag-input").value = ""; }
function carregarChips(palavras) { tagsAtivas = palavras.slice(); renderChips(); }

function atualizarDatalist() {
    const dl = document.getElementById("categorias-list");
    if (!dl) return;
    dl.innerHTML = Array.from(categoriasCache).sort().map(c => '<option value="' + sanitize(c) + '">').join("");
}

// CADASTRAR / ATUALIZAR
async function salvarAssunto() {
    const titulo    = document.getElementById("titulo").value.trim();
    const categoria = document.getElementById("categoria").value.trim();
    const assunto   = document.getElementById("assunto").value.trim();

    if (!titulo)  { toast("Preencha o titulo (nome para localizar).", "error"); document.getElementById("titulo").focus(); return; }
    if (!assunto) { toast("Preencha o ASSUNTO (texto que sera copiado).", "error"); document.getElementById("assunto").focus(); return; }
    if (tagsAtivas.length === 0) { toast("Adicione ao menos uma palavra-chave.", "error"); document.getElementById("tag-input").focus(); return; }

    const dados = {
        titulo: titulo,
        palavras_chave: tagsAtivas,
        categoria: categoria || "Geral",
        descricao: assunto
    };

    const btn = document.getElementById("btn-cadastrar");
    if (btn) btn.disabled = true;

    try {
        if (editandoId) {
            await assuntosRef.doc(editandoId).update(Object.assign({}, dados, { data_atualizacao: firebase.firestore.FieldValue.serverTimestamp() }));
            toast("Assunto atualizado!");
            cancelarEdicao();
        } else {
            await assuntosRef.add(Object.assign({}, dados, { data_cadastro: firebase.firestore.FieldValue.serverTimestamp() }));
            toast("Assunto cadastrado!");
        }
        limparFormulario();
        carregarAssuntos();
    } catch (error) {
        console.error("Erro ao salvar:", error);
        toast("Erro ao salvar.", "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

function limparFormulario() {
    document.getElementById("titulo").value = "";
    document.getElementById("categoria").value = "";
    document.getElementById("assunto").value = "";
    limparChips();
    editandoId = null;
    document.getElementById("btn-label").textContent = "Cadastrar Assunto";
    const banner = document.getElementById("edit-mode-banner");
    if (banner) banner.classList.remove("show");
}

async function removerAssunto(id, titulo) {
    if (!confirm('Remover "' + titulo + '"?\n\nEsta acao nao pode ser desfeita.')) return;
    try {
        await assuntosRef.doc(id).delete();
        favoritos = favoritos.filter(f => f !== id); lsSet(LS_FAV, favoritos);
        toast("Assunto removido.");
        carregarAssuntos();
    } catch (error) {
        console.error("Erro ao remover:", error);
        toast("Erro ao remover.", "error");
    }
}

function editarAssunto(id) {
    const a = listaCache.find(x => x.id === id);
    if (!a) return;
    document.getElementById("titulo").value = a.titulo || "";
    document.getElementById("categoria").value = a.categoria || "";
    document.getElementById("assunto").value = a.descricao || "";
    carregarChips(a.palavras_chave || []);
    editandoId = id;
    document.getElementById("btn-label").textContent = "Salvar Alteracoes";
    const banner = document.getElementById("edit-mode-banner");
    if (banner) banner.classList.add("show");
    irPara("gerenciar");
    setTimeout(() => {
        document.getElementById("titulo").focus();
        document.getElementById("titulo").scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
}

function cancelarEdicao() { limparFormulario(); }

// BUSCA
function buscarDebounce() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(buscarAssuntos, 250);
    const limpar = document.getElementById("limpar-busca");
    if (limpar) limpar.style.display = document.getElementById("busca").value ? "flex" : "none";
}

function limparBusca() {
    document.getElementById("busca").value = "";
    document.getElementById("limpar-busca").style.display = "none";
    document.getElementById("busca").focus();
    renderInicio();
}

function filtrarCategoria(cat) {
    categoriaFiltro = (categoriaFiltro === cat) ? null : cat;
    document.querySelectorAll(".cat-chip").forEach(c => {
        c.classList.toggle("ativo", c.dataset.cat === categoriaFiltro);
    });
    const termo = document.getElementById("busca").value.trim();
    if (termo) buscarAssuntos(); else renderInicio();
}

function buscarAssuntos() {
    const termo = document.getElementById("busca").value.trim().toLowerCase();
    if (!termo && !categoriaFiltro) { renderInicio(); return; }

    const palavras = termo.split(/\s+/).filter(Boolean);
    const resultados = [];

    listaCache.forEach(a => {
        if (categoriaFiltro && (a.categoria || "Geral") !== categoriaFiltro) return;
        const titulo = (a.titulo || "").toLowerCase();
        const desc   = (a.descricao || "").toLowerCase();
        const tags   = (a.palavras_chave || []).map(p => p.toLowerCase());
        let rel = 0;
        if (palavras.length === 0) {
            rel = 1;
        } else {
            palavras.forEach(b => {
                if (titulo.includes(b)) rel += 40;
                if (desc.includes(b)) rel += 20;
                if (tags.some(p => p.includes(b))) rel += 30;
            });
        }
        if (rel > 0) resultados.push(Object.assign({}, a, { relevancia: Math.min(rel, 100) }));
    });

    resultados.sort((a, b) => b.relevancia - a.relevancia);
    renderResultados(resultados, palavras, termo);
}

// TELA INICIAL DA BUSCA
function renderInicio() {
    const el = document.getElementById("resultados");
    if (!el) return;
    renderFiltrosCategoria();

    if (listaCache.length === 0) {
        el.innerHTML = '<div class="empty"><i class="fas fa-folder-open"></i><p>Nenhum assunto cadastrado ainda.</p><button class="btn btn-ghost" onclick="irPara(\'gerenciar\')"><i class="fas fa-plus"></i> Cadastrar o primeiro</button></div>';
        return;
    }
    if (categoriaFiltro) { buscarAssuntos(); return; }

    let html = "";
    const favs = listaCache.filter(a => favoritos.includes(a.id));
    if (favs.length > 0) {
        html += '<div class="secao-titulo"><i class="fas fa-star"></i> Favoritos</div>';
        html += favs.map(a => cardAssunto(a, [])).join("");
    }
    const maisUsados = listaCache.slice()
        .filter(a => usos[a.id] > 0 && !favoritos.includes(a.id))
        .sort((a, b) => (usos[b.id] || 0) - (usos[a.id] || 0))
        .slice(0, 5);
    if (maisUsados.length > 0) {
        html += '<div class="secao-titulo"><i class="fas fa-fire"></i> Mais usados</div>';
        html += maisUsados.map(a => cardAssunto(a, [])).join("");
    }
    if (favs.length === 0 && maisUsados.length === 0) {
        html += '<div class="secao-titulo"><i class="fas fa-clock"></i> Cadastrados recentemente</div>';
        html += listaCache.slice(0, 6).map(a => cardAssunto(a, [])).join("");
    }
    el.innerHTML = html;
    ligarEventosCards(el);
}

function renderFiltrosCategoria() {
    const cont = document.getElementById("filtros-categoria");
    if (!cont) return;
    const cats = Array.from(new Set(listaCache.map(a => a.categoria || "Geral"))).sort();
    if (cats.length <= 1) { cont.innerHTML = ""; return; }
    cont.innerHTML = cats.map(c =>
        '<button class="cat-chip ' + (categoriaFiltro === c ? 'ativo' : '') + '" data-cat="' + sanitize(c) + '" onclick="filtrarCategoria(\'' + sanitize(c).replace(/'/g, "\\'") + '\')">' + sanitize(c) + '</button>'
    ).join("");
}

function renderResultados(resultados, palavras, termo) {
    const el = document.getElementById("resultados");
    renderFiltrosCategoria();
    if (resultados.length === 0) {
        el.innerHTML = '<div class="empty"><i class="fas fa-magnifying-glass"></i><p>Nada encontrado' + (termo ? ' para "<strong>' + sanitize(termo) + '</strong>"' : "") + '.</p><button class="btn btn-ghost" onclick="irParaCadastro(\'' + sanitize(termo).replace(/'/g, "\\'") + '\')"><i class="fas fa-plus"></i> Cadastrar novo assunto</button></div>';
        return;
    }
    const cont = resultados.length === 1 ? "1 resultado" : (resultados.length + " resultados");
    let html = '<div class="resultado-contador">' + cont + (categoriaFiltro ? ' em <strong>' + sanitize(categoriaFiltro) + '</strong>' : "") + '</div>';
    html += resultados.map(a => cardAssunto(a, palavras)).join("");
    el.innerHTML = html;
    ligarEventosCards(el);
}

// CARD
function cardAssunto(a, palavras) {
    palavras = palavras || [];
    const tags = (a.palavras_chave || []).map(t => {
        const match = palavras.some(b => t.toLowerCase().includes(b) || b.includes(t.toLowerCase()));
        return '<span class="tag ' + (match ? 'match' : '') + '">' + sanitize(t) + '</span>';
    }).join("");
    const ehFav = favoritos.includes(a.id);
    const temXX = /X{2,}/.test(a.descricao || "");
    const preview = sanitize(a.descricao || "");

    return '<div class="card-assunto" data-id="' + a.id + '">' +
        '<div class="card-top">' +
            '<div class="card-cat"><i class="fas fa-folder"></i> ' + sanitize(a.categoria || "Geral") + '</div>' +
            '<button class="btn-fav ' + (ehFav ? 'ativo' : '') + '" data-fav="' + a.id + '" title="' + (ehFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos') + '"><i class="' + (ehFav ? 'fas' : 'far') + ' fa-star"></i></button>' +
        '</div>' +
        '<h3 class="card-titulo">' + sanitize(a.titulo) + '</h3>' +
        (tags ? '<div class="card-tags">' + tags + '</div>' : "") +
        '<div class="card-assunto-texto">' + preview + '</div>' +
        '<div class="card-acoes">' +
            '<button class="btn btn-primary btn-copiar" data-copiar="' + a.id + '"><i class="fas fa-copy"></i> ' + (temXX ? "Preencher e copiar" : "Copiar assunto") + '</button>' +
            '<button class="btn btn-ghost btn-icon" data-editar="' + a.id + '" title="Editar"><i class="fas fa-pencil"></i></button>' +
        '</div>' +
    '</div>';
}

function ligarEventosCards(container) {
    container.querySelectorAll("[data-copiar]").forEach(b => b.addEventListener("click", () => acaoCopiar(b.dataset.copiar)));
    container.querySelectorAll("[data-editar]").forEach(b => b.addEventListener("click", () => editarAssunto(b.dataset.editar)));
    container.querySelectorAll("[data-fav]").forEach(b => b.addEventListener("click", () => toggleFavorito(b.dataset.fav)));
}

// FAVORITOS
function toggleFavorito(id) {
    if (favoritos.includes(id)) {
        favoritos = favoritos.filter(f => f !== id);
        toast("Removido dos favoritos.", "info");
    } else {
        favoritos.push(id);
        toast("Adicionado aos favoritos!");
    }
    lsSet(LS_FAV, favoritos);
    const termo = document.getElementById("busca") ? document.getElementById("busca").value.trim() : "";
    if (termo || categoriaFiltro) buscarAssuntos(); else renderInicio();
}

// COPIAR com preenchimento de XX
function acaoCopiar(id) {
    const a = listaCache.find(x => x.id === id);
    if (!a || !a.descricao) { toast("Sem texto para copiar.", "error"); return; }
    if (/X{2,}/.test(a.descricao)) abrirPreenchimento(a);
    else copiarTexto(a.descricao, a);
}

function copiarTexto(texto, assunto) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(texto).then(() => {
            toast("Assunto copiado!");
            registrarUso(assunto, texto);
        }).catch(() => fallbackCopiar(texto, assunto));
    } else {
        fallbackCopiar(texto, assunto);
    }
}
function fallbackCopiar(texto, assunto) {
    const ta = document.createElement("textarea");
    ta.value = texto; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Assunto copiado!"); registrarUso(assunto, texto); }
    catch { toast("Nao foi possivel copiar.", "error"); }
    document.body.removeChild(ta);
}

function registrarUso(assunto, textoFinal) {
    usos[assunto.id] = (usos[assunto.id] || 0) + 1;
    lsSet(LS_USOS, usos);
    historico.unshift({ texto: textoFinal, titulo: assunto.titulo, data: Date.now() });
    historico = historico.slice(0, 20);
    lsSet(LS_HIST, historico);
    atualizarBadgeHistorico();
}

// MODAL DE PREENCHIMENTO
let modalAssuntoAtual = null;
let modalTrechos = [];

function abrirPreenchimento(a) {
    modalAssuntoAtual = a;
    const texto = a.descricao;
    modalTrechos = [];
    const regex = /(X{2,})/g;
    let ultimo = 0, m, idx = 0;
    const campos = [];
    while ((m = regex.exec(texto)) !== null) {
        modalTrechos.push({ tipo: "texto", valor: texto.slice(ultimo, m.index) });
        modalTrechos.push({ tipo: "campo", id: idx, original: m[0] });
        campos.push({ id: idx, original: m[0] });
        ultimo = m.index + m[0].length;
        idx++;
    }
    modalTrechos.push({ tipo: "texto", valor: texto.slice(ultimo) });

    const corpo = document.getElementById("modal-campos");
    corpo.innerHTML = campos.map(c =>
        '<div class="modal-campo"><label>Campo ' + (c.id + 1) + ' <span class="modal-campo-hint">(' + c.original + ')</span></label>' +
        '<input type="text" data-campo="' + c.id + '" oninput="atualizarPreview()" placeholder="Digite o valor..." autocomplete="off"></div>'
    ).join("");

    document.getElementById("modal-titulo-assunto").textContent = a.titulo;
    atualizarPreview();
    document.getElementById("modal-preencher").classList.add("aberto");
    setTimeout(() => { const inp = corpo.querySelector("input"); if (inp) inp.focus(); }, 100);
}

function atualizarPreview() {
    const valores = {};
    document.querySelectorAll("#modal-campos input").forEach(inp => { valores[inp.dataset.campo] = inp.value; });
    let html = "", textoFinal = "";
    modalTrechos.forEach(t => {
        if (t.tipo === "texto") { html += sanitize(t.valor); textoFinal += t.valor; }
        else {
            const v = valores[t.id];
            if (v) { html += '<mark>' + sanitize(v) + '</mark>'; textoFinal += v; }
            else { html += '<span class="ph">' + sanitize(t.original) + '</span>'; textoFinal += t.original; }
        }
    });
    document.getElementById("modal-preview").innerHTML = html;
    document.getElementById("modal-preencher").dataset.textoFinal = textoFinal;
}

function confirmarPreenchimento() {
    copiarTexto(document.getElementById("modal-preencher").dataset.textoFinal, modalAssuntoAtual);
    fecharModal();
}
function copiarSemPreencher() {
    copiarTexto(modalAssuntoAtual.descricao, modalAssuntoAtual);
    fecharModal();
}
function fecharModal() {
    document.getElementById("modal-preencher").classList.remove("aberto");
    modalAssuntoAtual = null;
}

// HISTORICO
function abrirHistorico() {
    const painel = document.getElementById("painel-historico");
    const lista = document.getElementById("lista-historico");
    if (historico.length === 0) {
        lista.innerHTML = '<div class="empty-mini"><i class="fas fa-clock-rotate-left"></i> Nada copiado ainda.</div>';
    } else {
        lista.innerHTML = historico.map((h, i) =>
            '<div class="hist-item"><div class="hist-texto">' + sanitize(h.texto) + '</div>' +
            '<div class="hist-meta"><span>' + sanitize(h.titulo) + ' &middot; ' + tempoAtras(h.data) + '</span>' +
            '<button class="btn-mini" onclick="recopiar(' + i + ')"><i class="fas fa-copy"></i> Copiar</button></div></div>'
        ).join("");
    }
    painel.classList.add("aberto");
}
function fecharHistorico() { document.getElementById("painel-historico").classList.remove("aberto"); }
function recopiar(i) {
    const h = historico[i];
    if (!h) return;
    if (navigator.clipboard) navigator.clipboard.writeText(h.texto);
    toast("Copiado novamente!");
}
function limparHistorico() {
    if (!confirm("Limpar todo o historico de copias?")) return;
    historico = []; lsSet(LS_HIST, historico);
    abrirHistorico(); atualizarBadgeHistorico();
    toast("Historico limpo.", "info");
}
function atualizarBadgeHistorico() {
    const b = document.getElementById("badge-hist");
    if (!b) return;
    b.textContent = historico.length;
    b.style.display = historico.length > 0 ? "flex" : "none";
}
function tempoAtras(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "agora";
    if (s < 3600) return "ha " + Math.floor(s/60) + " min";
    if (s < 86400) return "ha " + Math.floor(s/3600) + " h";
    return "ha " + Math.floor(s/86400) + " d";
}

// LISTA NA TELA GERENCIAR
function renderItemLista(item) {
    return '<li><div class="info"><strong>' + sanitize(item.titulo) + '</strong>' +
        '<small>' + (item.palavras_chave || []).map(sanitize).join(" &middot; ") + '</small></div>' +
        '<div class="actions">' +
        '<button class="btn btn-ghost btn-icon" onclick="editarAssunto(\'' + item.id + '\')" title="Editar"><i class="fas fa-pencil"></i></button>' +
        '<button class="btn btn-danger-ghost btn-icon" onclick="removerAssunto(\'' + item.id + '\',\'' + sanitize(item.titulo).replace(/'/g, "\\'") + '\')" title="Remover"><i class="fas fa-trash"></i></button>' +
        '</div></li>';
}
function renderListaAgrupada(itens) {
    const el = document.getElementById("lista_assuntos");
    if (itens.length === 0) {
        el.innerHTML = '<div class="empty-mini"><i class="fas fa-inbox"></i> Nenhum assunto.</div>';
        return;
    }
    const grupos = {};
    itens.forEach(item => {
        const cat = item.categoria || "Geral";
        (grupos[cat] = grupos[cat] || []).push(item);
    });
    let html = "";
    Object.keys(grupos).sort().forEach(cat => {
        html += '<div class="grupo-titulo">' + sanitize(cat) + ' <span>' + grupos[cat].length + '</span></div>';
        html += '<ul class="assunto-list">' + grupos[cat].map(renderItemLista).join("") + '</ul>';
    });
    el.innerHTML = html;
}
function filtrarLista() {
    const termo = (document.getElementById("filtro-lista-input") ? document.getElementById("filtro-lista-input").value : "").toLowerCase().trim();
    if (!termo) { renderListaAgrupada(listaCache); return; }
    renderListaAgrupada(listaCache.filter(item =>
        (item.titulo || "").toLowerCase().includes(termo) ||
        (item.categoria || "").toLowerCase().includes(termo) ||
        (item.palavras_chave || []).some(p => p.toLowerCase().includes(termo))
    ));
}
function atualizarContador(n) {
    const lc = document.getElementById("lista-count");
    if (lc) lc.textContent = n + (n === 1 ? " assunto" : " assuntos");
    const tc = document.getElementById("total-count");
    if (tc) tc.textContent = n;
}

// CARREGAR DADOS
function processarSnapshot(snapshot) {
    listaCache = [];
    categoriasCache.clear();
    snapshot.forEach(doc => {
        const a = Object.assign({ id: doc.id }, doc.data());
        listaCache.push(a);
        if (a.categoria) categoriasCache.add(a.categoria);
    });
    atualizarContador(listaCache.length);
    atualizarDatalist();
    if (document.getElementById("tela-gerenciar") && document.getElementById("tela-gerenciar").classList.contains("ativa")) {
        filtrarLista();
    }
    if (document.getElementById("tela-buscar") && document.getElementById("tela-buscar").classList.contains("ativa")) {
        const termo = document.getElementById("busca") ? document.getElementById("busca").value.trim() : "";
        if (termo || categoriaFiltro) buscarAssuntos(); else renderInicio();
    }
}
async function carregarAssuntos() {
    try {
        let snap;
        try { snap = await assuntosRef.orderBy("data_cadastro", "desc").limit(LIMITE).get(); }
        catch { snap = await assuntosRef.limit(LIMITE).get(); }
        processarSnapshot(snap);
    } catch (error) {
        console.error("Erro ao carregar:", error);
        const el = document.getElementById("lista_assuntos");
        if (el) el.innerHTML = '<div class="empty-mini" style="color:var(--danger)"><i class="fas fa-circle-exclamation"></i> Erro ao carregar. Verifique o Firebase.</div>';
    }
}
function irParaCadastro(termoBusca) {
    irPara("gerenciar");
    setTimeout(() => {
        document.getElementById("titulo").value = termoBusca || "";
        document.getElementById("assunto").focus();
    }, 200);
}

// UTILITARIOS
async function cadastrarAssuntoTeste() {
    const exemplos = [
        { titulo: "Compensacao de dias - diretor do Foro", palavras_chave: ["compensacao","plantao","diretor"], categoria: "E-mail", descricao: "Concessao de XX (XXX) dias de compensacao ao(a) Dr(a). XXXXXXXXXXXX, para usufruto nos dias XX e XX de XXXXX de 202X." },
        { titulo: "Remarcacao de ferias - magistrado", palavras_chave: ["remarcacao","ferias","magistrado"], categoria: "E-mail", descricao: "Remarcacao das ferias relativas ao Xo periodo de 202X, para usufruto no periodo de XX de XXXXXX a XX de XXXXXX de 202X." },
        { titulo: "Solicitacao de documentos", palavras_chave: ["documento","certidao","copia"], categoria: "Oficio", descricao: "Solicito a Vossa Senhoria o envio de copia dos documentos referentes ao processo no XXXXXXX." }
    ];
    for (const a of exemplos) {
        await assuntosRef.add(Object.assign({}, a, { data_cadastro: firebase.firestore.FieldValue.serverTimestamp() }));
        console.log("Cadastrado:", a.titulo);
    }
    toast("Exemplos cadastrados!");
    carregarAssuntos();
}

// INICIALIZACAO
window.addEventListener("load", () => {
    console.log("Sistema carregado. cadastrarAssuntoTeste() para inserir exemplos.");
    atualizarBadgeHistorico();
    document.addEventListener("keydown", (e) => {
        if (e.key === "/" && !["INPUT","TEXTAREA"].includes(document.activeElement.tagName)) {
            e.preventDefault();
            irPara("buscar");
        }
        if (e.key === "Escape") { fecharModal(); fecharHistorico(); }
    });
    if (auth) {
        auth.onAuthStateChanged((user) => { if (user) carregarAssuntos(); });
    } else {
        carregarAssuntos();
    }
});
