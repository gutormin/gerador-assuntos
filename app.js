// ═══════════════════════════════════════════════════════════════
//  CONFIGURAÇÃO FIREBASE
// ═══════════════════════════════════════════════════════════════
const firebaseConfig = {
  apiKey: "AIzaSyApOPpXrpN1-tnM7xvKgNlaKI_UA_s-D60",
  authDomain: "gerador-de-assuntos-9bfe4.firebaseapp.com",
  projectId: "gerador-de-assuntos-9bfe4",
  storageBucket: "gerador-de-assuntos-9bfe4.firebasestorage.app",
  messagingSenderId: "273319840643",
  appId: "1:273319840643:web:4f1f2b6979c39e8c0a44b6",
  measurementId: "G-5X8SSQRQ8S"
};

let db, assuntosRef, modelosRef, enderecamentosRef, auth;

try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    assuntosRef = db.collection("assuntos");
    modelosRef = db.collection("modelos_oficio");
    enderecamentosRef = db.collection("enderecamentos");
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

// ═══════════════════════════════════════════════════════════════
//  DETECÇÃO E PROCESSAMENTO DE VARIÁVEIS (XX, Xº, 202X, etc.)
// ═══════════════════════════════════════════════════════════════
const REGEX_VARIAVEIS_STR = "(?<![A-WY-Za-wy-z0-9])\\d*X+(?:[ºª°]|(?<=\\bX)[oa]\\b)?(?![A-Za-z0-9])";

function temVariaveis(texto) {
    if (!texto) return false;
    const regex = new RegExp(REGEX_VARIAVEIS_STR, "g");
    return regex.test(texto);
}

function obterRegexVariaveis() {
    return new RegExp(REGEX_VARIAVEIS_STR, "g");
}

function processarValorCampo(val, original) {
    if (!val) return "";
    val = val.trim();
    if (!val) return "";
    
    // Se o original for do tipo ano "202X", "20X", etc.
    const mAno = /^(\d+)(X+)$/.exec(original);
    if (mAno) {
        const prefixo = mAno[1];
        const qtdX = mAno[2].length;
        if (val.length <= qtdX && /^\d+$/.test(val)) {
            return prefixo + val;
        }
        if (val.startsWith(prefixo)) {
            return val;
        }
    }

    // Se o original for ordinal tipo "Xº", "Xª", "X°", "Xo", "Xa"
    const mOrdinal = /^X([ºª°oa])$/.exec(original);
    if (mOrdinal) {
        const suf = mOrdinal[1];
        if (/^\d+$/.test(val)) {
            return val + (suf === 'o' ? 'º' : suf === 'a' ? 'ª' : suf);
        }
    }

    return val;
}

// Estado global
let editandoId      = null;
let tagsAtivas      = [];
let categoriasCache = new Set();
let debounceTimer   = null;
let listaCache      = [];
let categoriaFiltro = null;

let editandoModeloId     = null;
let listaModelosCache    = [];
let debounceTimerModelos = null;
const LS_MODELOS         = "ga_modelos";

let todosEnderecamentos    = [];
let filtroEnderecosAtual   = 'todos';
let debounceEnderecosTimer = null;
let todosPronomes          = [];
let todosVocativos         = [];

const LIMITE = 500;

// Dados pessoais (localStorage)
const LS_FAV = "ga_favoritos";
const LS_HIST = "ga_historico";
const LS_USOS = "ga_usos";
const LS_PRONOMES = "ga_pronomes_custom";
const LS_VOCATIVOS = "ga_vocativos_custom";

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
    if ((tela === "gerenciar" || tela === "cadastro-oficio" || tela === "cadastro-endereco") && !ehAdmin()) {
        toast("Acesso exclusivo para administradores.", "error");
        abrirModalAdmin();
        return;
    }
    document.querySelectorAll(".tela").forEach(t => t.classList.remove("ativa"));
    const telaEl = document.getElementById("tela-" + tela);
    if (telaEl) telaEl.classList.add("ativa");
    
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("ativo", b.dataset.tela === tela));
    if (tela === "buscar") {
        setTimeout(() => document.getElementById("busca")?.focus(), 100);
        renderInicio();
    }
    if (tela === "gerenciar") carregarAssuntos();
    if (tela === "buscar-oficio") {
        carregarModelos();
        setTimeout(() => document.getElementById("busca-modelos")?.focus(), 100);
    }
    if (tela === "cadastro-oficio") {
        carregarModelos();
        renderAssuntosCheckboxes();
        setTimeout(() => document.getElementById("modelo-titulo")?.focus(), 100);
    }
    if (tela === "enderecos") {
        carregarEnderecamentos();
        setTimeout(() => document.getElementById("busca-enderecos")?.focus(), 100);
    }
    if (tela === "cadastro-endereco") {
        setTimeout(() => document.getElementById("e-competencia")?.focus(), 100);
    }
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

function duplicarAssunto(id) {
    const a = listaCache.find(x => x.id === id);
    if (!a) return;
    document.getElementById("titulo").value = "Copia de " + (a.titulo || "");
    document.getElementById("categoria").value = a.categoria || "";
    document.getElementById("assunto").value = a.descricao || "";
    carregarChips(a.palavras_chave || []);
    editandoId = null;
    document.getElementById("btn-label").textContent = "Cadastrar Assunto";
    const banner = document.getElementById("edit-mode-banner");
    if (banner) banner.classList.remove("show");
    irPara("gerenciar");
    setTimeout(() => {
        const t = document.getElementById("titulo");
        t.focus(); t.select();
        t.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    toast("Campos copiados! Edite o titulo e clique em Cadastrar.", "info");
}

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
    const modelosResultados = [];

    // Busca nos assuntos
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

    // Busca nos modelos de ofício
    if (palavras.length > 0 && !categoriaFiltro) {
        listaModelosCache.forEach(m => {
            const tit = (m.titulo || "").toLowerCase();
            const desc = (m.descricao || "").toLowerCase();
            const corp = (m.corpo || "").toLowerCase();
            let rel = 0;
            palavras.forEach(b => {
                if (tit.includes(b)) rel += 40;
                if (desc.includes(b)) rel += 20;
                if (corp.includes(b)) rel += 10;
            });
            if (rel > 0) modelosResultados.push(Object.assign({}, m, { relevancia: Math.min(rel, 100) }));
        });
    }

    resultados.sort((a, b) => b.relevancia - a.relevancia);
    modelosResultados.sort((a, b) => b.relevancia - a.relevancia);
    
    renderResultados(resultados, palavras, termo, modelosResultados);
}

// TELA INICIAL DA BUSCA
function renderInicio() {
    const el = document.getElementById("resultados");
    if (!el) return;
    renderFiltrosCategoria();

    if (listaCache.length === 0) {
        el.innerHTML = '<div class="empty"><i class="fas fa-folder-open"></i><p>Nenhum assunto cadastrado ainda.</p><button class="btn btn-ghost admin-only" onclick="irPara(\'gerenciar\')"><i class="fas fa-plus"></i> Cadastrar o primeiro</button></div>';
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

function renderResultados(resultados, palavras, termo, modelosResultados) {
    const el = document.getElementById("resultados");
    renderFiltrosCategoria();
    
    modelosResultados = modelosResultados || [];
    
    if (resultados.length === 0 && modelosResultados.length === 0) {
        el.innerHTML = '<div class="empty"><i class="fas fa-magnifying-glass"></i><p>Nada encontrado' + (termo ? ' para "<strong>' + sanitize(termo) + '</strong>"' : "") + '.</p><button class="btn btn-ghost admin-only" onclick="irParaCadastro(\'' + sanitize(termo).replace(/'/g, "\\'") + '\')"><i class="fas fa-plus"></i> Cadastrar novo assunto</button></div>';
        return;
    }
    
    let html = "";
    
    if (resultados.length > 0) {
        const cont = resultados.length === 1 ? "1 assunto encontrado" : (resultados.length + " assuntos encontrados");
        html += '<div class="resultado-contador">' + cont + (categoriaFiltro ? ' em <strong>' + sanitize(categoriaFiltro) + '</strong>' : "") + '</div>';
        html += resultados.map(a => cardAssunto(a, palavras)).join("");
    }
    
    if (modelosResultados.length > 0) {
        html += '<div class="secao-titulo" style="margin-top: 24px;"><i class="fas fa-file-invoice"></i> Modelos de Ofício Encontrados</div>';
        html += modelosResultados.map(m => {
            const temXX = temVariaveis(m.corpo);
            const vincs = (m.assuntos_vinculados || []).map(sid => {
                const ass = listaCache.find(a => a.id === sid);
                return ass ? sanitize(ass.titulo) : null;
            }).filter(Boolean);
            
            const vincText = vincs.length > 0 
                ? '<div style="margin-top: 4px; font-size: 0.76rem; color: var(--green-700);"><i class="fas fa-link"></i> Vinculado a: ' + vincs.join(", ") + '</div>' 
                : '';

            const corpoToggle = m.corpo 
                ? '<div class="card-modelo-corpo-toggle" style="margin-top: 8px; margin-bottom: 8px;">' +
                    '<button type="button" onclick="toggleCorpoCard(this)" style="background: none; border: none; color: var(--accent); font-size: 0.8rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px; padding: 0; outline: none;">' +
                        '<i class="fas fa-chevron-down"></i> Ver corpo do documento' +
                    '</button>' +
                    '<div class="modelo-corpo-completo" style="display: none; margin-top: 8px; background: var(--sand-200); padding: 12px; border-radius: var(--r-sm); font-size: 0.82rem; font-family: monospace; white-space: pre-wrap; color: var(--ink); border-left: 3px solid var(--accent); line-height: 1.5; max-height: 180px; overflow-y: auto;">' + sanitize(m.corpo) + '</div>' +
                  '</div>'
                : '';

            return '<div class="card-assunto card-modelo-resultado" data-modelo-id="' + m.id + '" style="border-color: var(--border); margin-bottom: 12px;">' +
                '<div class="card-top">' +
                    '<div class="card-cat"><i class="fas fa-file-invoice"></i> Modelo de Ofício</div>' +
                '</div>' +
                '<h3 class="card-titulo">' + sanitize(m.titulo) + '</h3>' +
                (m.descricao ? '<p style="font-size: 0.85rem; color: var(--ink-muted); margin-bottom: 4px;">' + sanitize(m.descricao) + '</p>' : "") +
                vincText +
                corpoToggle +
                '<div class="card-acoes" style="margin-top: 10px;">' +
                    '<button type="button" class="btn btn-primary btn-sm btn-copiar-modelo-sug" data-modelo-sug-id="' + m.id + '"><i class="fas fa-file-pen"></i> ' + (temXX ? "Preencher e copiar" : "Copiar documento") + '</button>' +
                '</div>' +
            '</div>';
        }).join("");
    }
    
    el.innerHTML = html;
    ligarEventosCards(el);
    
    // Liga eventos específicos dos botões de preenchimento dos modelos encontrados
    el.querySelectorAll(".btn-copiar-modelo-sug").forEach(b => {
        b.addEventListener("click", (e) => {
            e.stopPropagation();
            abrirPreenchimentoModeloPorId(b.dataset.modeloSugId);
        });
    });
}

// CARD
function cardAssunto(a, palavras) {
    palavras = palavras || [];
    const tags = (a.palavras_chave || []).map(t => {
        const match = palavras.some(b => t.toLowerCase().includes(b) || b.includes(t.toLowerCase()));
        return '<span class="tag ' + (match ? 'match' : '') + '">' + sanitize(t) + '</span>';
    }).join("");
    const ehFav = favoritos.includes(a.id);
    const temXX = temVariaveis(a.descricao);
    const preview = sanitize(a.descricao || "");

    // Modelos vinculados sugeridos
    const modelosSugeridos = listaModelosCache.filter(m => m.assuntos_vinculados && m.assuntos_vinculados.includes(a.id));
    let htmlModelos = "";
    if (modelosSugeridos.length > 0) {
        htmlModelos = '<div class="modelos-sugeridos" style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed var(--border); display: flex; flex-direction: column; gap: 6px;">' +
            '<span style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: var(--ink-muted); display: flex; align-items: center; gap: 5px;"><i class="fas fa-file-invoice"></i> Modelos de Ofício sugeridos:</span>' +
            '<div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px;">' +
            modelosSugeridos.map(m => 
                '<button type="button" class="btn btn-outline btn-sm btn-modelo-sug" data-modelo-sug-id="' + m.id + '" style="padding: 4px 10px; font-size: 0.75rem; min-height: 28px; display: inline-flex; align-items: center; gap: 5px;">' +
                '<i class="fas fa-file-signature"></i> ' + sanitize(m.titulo) +
                '</button>'
            ).join("") +
            '</div>' +
            '</div>';
    }

    return '<div class="card-assunto" data-id="' + a.id + '">' +
        '<div class="card-top">' +
            '<div class="card-cat"><i class="fas fa-folder"></i> ' + sanitize(a.categoria || "Geral") + '</div>' +
            '<button class="btn-fav ' + (ehFav ? 'ativo' : '') + '" data-fav="' + a.id + '" title="' + (ehFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos') + '"><i class="' + (ehFav ? 'fas' : 'far') + ' fa-star"></i></button>' +
        '</div>' +
        '<h3 class="card-titulo">' + sanitize(a.titulo) + '</h3>' +
        (tags ? '<div class="card-tags">' + tags + '</div>' : "") +
        '<div class="card-assunto-texto">' + preview + '</div>' +
        htmlModelos +
        '<div class="card-acoes" style="margin-top: 14px;">' +
            '<button class="btn btn-primary btn-copiar" data-copiar="' + a.id + '"><i class="fas fa-copy"></i> ' + (temXX ? "Preencher e copiar" : "Copiar assunto") + '</button>' +
            '<button class="btn btn-ghost btn-icon admin-only" data-editar="' + a.id + '" title="Editar"><i class="fas fa-pencil"></i></button>' +
        '</div>' +
    '</div>';
}

function ligarEventosCards(container) {
    container.querySelectorAll("[data-copiar]").forEach(b => b.addEventListener("click", () => acaoCopiar(b.dataset.copiar)));
    container.querySelectorAll("[data-editar]").forEach(b => b.addEventListener("click", () => editarAssunto(b.dataset.editar)));
    container.querySelectorAll("[data-fav]").forEach(b => b.addEventListener("click", () => toggleFavorito(b.dataset.fav)));
    container.querySelectorAll(".btn-modelo-sug").forEach(b => {
        b.addEventListener("click", (e) => {
            e.stopPropagation();
            abrirPreenchimentoModeloPorId(b.dataset.modeloSugId);
        });
    });
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
    if (temVariaveis(a.descricao)) abrirPreenchimento(a);
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
    const regex = obterRegexVariaveis();
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
        '<div class="modal-campo"><label>Campo ' + (c.id + 1) + ' <span class="modal-campo-hint">(' + sanitize(c.original) + ')</span></label>' +
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
            const rawVal = valores[t.id];
            const v = processarValorCampo(rawVal, t.original);
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
        '<button class="btn btn-ghost btn-icon" onclick="duplicarAssunto(\'' + item.id + '\')" title="Duplicar — copia todos os campos para um novo cadastro"><i class="fas fa-copy"></i></button>' +
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
const DADOS_INICIAIS_PADRAO = [];

function garantirDadosIniciais() {
    return lsGet("ga_assuntos", []);
}

async function carregarAssuntos() {
    let assuntosEncontrados = [];
    try {
        if (assuntosRef) {
            let snap;
            try { snap = await assuntosRef.orderBy("data_cadastro", "desc").limit(LIMITE).get(); }
            catch { snap = await assuntosRef.limit(LIMITE).get(); }
            if (snap && !snap.empty) {
                snap.forEach(doc => assuntosEncontrados.push(Object.assign({ id: doc.id }, doc.data())));
            }
        }
        if (assuntosEncontrados.length === 0 && db) {
            try {
                const altSnap = await db.collection("gerador_assuntos").limit(LIMITE).get();
                if (altSnap && !altSnap.empty) {
                    altSnap.forEach(doc => assuntosEncontrados.push(Object.assign({ id: doc.id }, doc.data())));
                }
            } catch (eAlt) {}
        }
    } catch (error) {
        console.warn("Erro ao buscar no Firebase, carregando dados locais:", error);
    }

    const localAssuntos = garantirDadosIniciais();
    const mapa = new Map();
    assuntosEncontrados.forEach(a => mapa.set(a.id, a));
    localAssuntos.forEach(a => { if (!mapa.has(a.id)) mapa.set(a.id, a); });
    
    listaCache = Array.from(mapa.values());
    categoriasCache.clear();
    listaCache.forEach(a => { if (a.categoria) categoriasCache.add(a.categoria); });
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

// ═══════════════════════════════════════════════════════════════
//  MÓDULO: MODELOS DE OFÍCIO
// ═══════════════════════════════════════════════════════════════

function renderAssuntosCheckboxes() {
    const cont = document.getElementById("assuntos-vinculo-container");
    if (!cont) return;
    if (listaCache.length === 0) {
        cont.innerHTML = '<div class="empty-mini">Nenhum assunto cadastrado para vincular</div>';
        return;
    }
    cont.innerHTML = listaCache.map(a => 
        '<label class="checkbox-group" style="display: flex; align-items: center; gap: 8px; font-size: 0.88rem; cursor: pointer; padding: 4px 0;">' +
        '<input type="checkbox" name="assunto-vinc" value="' + a.id + '" style="width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer;">' +
        '<span>' + sanitize(a.titulo) + ' <small style="color: var(--ink-muted);">(' + sanitize(a.categoria || "Geral") + ')</small></span>' +
        '</label>'
    ).join("");
}

async function salvarModelo() {
    const titulo = document.getElementById("modelo-titulo").value.trim();
    const descricao = document.getElementById("modelo-descricao").value.trim();
    const corpo = document.getElementById("modelo-corpo").value.trim();

    if (!titulo) { toast("Preencha o título do modelo.", "error"); document.getElementById("modelo-titulo").focus(); return; }
    if (!corpo) { toast("Preencha o corpo do documento.", "error"); document.getElementById("modelo-corpo").focus(); return; }

    const vinculos = [];
    document.querySelectorAll('input[name="assunto-vinc"]:checked').forEach(cb => {
        vinculos.push(cb.value);
    });

    const dados = {
        titulo: titulo,
        descricao: descricao,
        corpo: corpo,
        assuntos_vinculados: vinculos
    };

    const btn = document.getElementById("btn-cadastrar-modelo");
    if (btn) btn.disabled = true;

    try {
        let salvoNoFirebase = false;
        if (modelosRef) {
            try {
                if (editandoModeloId && !editandoModeloId.toString().startsWith("loc_")) {
                    await modelosRef.doc(editandoModeloId).update(Object.assign({}, dados, { data_atualizacao: firebase.firestore.FieldValue.serverTimestamp() }));
                    toast("Modelo de ofício atualizado!");
                } else {
                    await modelosRef.add(Object.assign({}, dados, { data_cadastro: firebase.firestore.FieldValue.serverTimestamp() }));
                    toast("Modelo de ofício cadastrado!");
                }
                salvoNoFirebase = true;
                if (editandoModeloId) cancelarEdicaoModelo();
            } catch (fbError) {
                console.warn("Erro ao salvar no Firebase, tentando LocalStorage:", fbError);
            }
        }

        if (!salvoNoFirebase) {
            let localModelos = lsGet(LS_MODELOS, []);
            if (editandoModeloId) {
                localModelos = localModelos.map(m => m.id === editandoModeloId ? Object.assign(m, dados, { data_atualizacao: Date.now() }) : m);
                toast("Modelo atualizado localmente (Firebase offline ou sem permissão)!", "info");
                cancelarEdicaoModelo();
            } else {
                const novo = Object.assign({ id: "loc_" + Date.now() }, dados, { data_cadastro: Date.now() });
                localModelos.push(novo);
                toast("Modelo cadastrado localmente (Firebase offline ou sem permissão)!", "info");
            }
            lsSet(LS_MODELOS, localModelos);
        }
        limparFormularioModelo();
        carregarModelos();
    } catch (error) {
        console.error("Erro ao salvar modelo:", error);
        toast("Erro ao salvar modelo.", "error");
    } finally {
        if (btn) btn.disabled = false;
    }
}

function limparFormularioModelo() {
    document.getElementById("modelo-titulo").value = "";
    document.getElementById("modelo-descricao").value = "";
    document.getElementById("modelo-corpo").value = "";
    document.querySelectorAll('input[name="assunto-vinc"]:checked').forEach(cb => cb.checked = false);
    editandoModeloId = null;
    document.getElementById("btn-label-modelo-txt").textContent = "Cadastrar Modelo";
    const banner = document.getElementById("edit-mode-banner-modelo");
    if (banner) banner.style.display = "none";
}

function cancelarEdicaoModelo() {
    limparFormularioModelo();
}

const MODELOS_PADRAO_OFICIO = [];

function garantirModelosIniciais() {
    return lsGet(LS_MODELOS, []);
}

function limparDadosExemploLocais() {
    ["padrao_1", "padrao_2", "padrao_3", "padrao_4", "padrao_5", "padrao_6"].forEach(id => {
        let ass = lsGet("ga_assuntos", []);
        if (Array.isArray(ass)) {
            lsSet("ga_assuntos", ass.filter(x => x && !x.id?.startsWith("padrao_")));
        }
    });
    ["mod_oficio_1", "mod_oficio_2", "mod_oficio_3", "mod_oficio_4"].forEach(id => {
        let mods = lsGet(LS_MODELOS, []);
        if (Array.isArray(mods)) {
            lsSet(LS_MODELOS, mods.filter(x => x && !x.id?.startsWith("mod_oficio_")));
        }
    });
}

async function carregarModelos() {
    let modelosEncontrados = [];
    try {
        if (modelosRef) {
            let snap;
            try { 
                snap = await modelosRef.orderBy("data_cadastro", "desc").limit(LIMITE).get(); 
            } catch (orderError) {
                console.warn("Tentando carregar modelos sem ordenação:", orderError);
                snap = await modelosRef.limit(LIMITE).get();
            }
            
            if (snap && !snap.empty) {
                snap.forEach(doc => modelosEncontrados.push(Object.assign({ id: doc.id }, doc.data())));
            }
        }
        
        // Se a coleção 'modelos_oficio' estiver vazia ou offline, tenta coleções alternativas ('modelos', 'oficios')
        if (modelosEncontrados.length === 0 && db) {
            const colecoesAlt = ["modelos", "oficios"];
            for (const col of colecoesAlt) {
                try {
                    const snapAlt = await db.collection(col).limit(LIMITE).get();
                    if (snapAlt && !snapAlt.empty) {
                        snapAlt.forEach(doc => modelosEncontrados.push(Object.assign({ id: doc.id }, doc.data())));
                        break;
                    }
                } catch (eAlt) {}
            }
        }
    } catch (error) {
        console.warn("Erro ao carregar modelos do Firebase:", error);
    }

    const localModelos = garantirModelosIniciais();
    const mapa = new Map();
    modelosEncontrados.forEach(m => mapa.set(m.id, m));
    localModelos.forEach(m => { if (!mapa.has(m.id)) mapa.set(m.id, m); });

    listaModelosCache = Array.from(mapa.values());
    atualizarContadorModelos(listaModelosCache.length);
    renderListaModelos(listaModelosCache);
}

function atualizarContadorModelos(n) {
    const mc = document.getElementById("lista-modelos-count");
    if (mc) mc.textContent = n + (n === 1 ? " modelo" : " modelos");
    const tmc = document.getElementById("total-modelos-count");
    if (tmc) tmc.textContent = n;
}

function renderListaModelos(modelos) {
    const elLista = document.getElementById("lista_modelos");
    const elResultados = document.getElementById("resultados_modelos");
    
    // 1. Render para a aba de CADASTRO/GESTÃO (com botões de ação completos)
    if (elLista) {
        if (modelos.length === 0) {
            elLista.innerHTML = '<div class="empty-mini"><i class="fas fa-inbox"></i> Nenhum modelo cadastrado.</div>';
        } else {
            elLista.innerHTML = modelos.map(m => {
                const vincs = (m.assuntos_vinculados || []).map(sid => {
                    const ass = listaCache.find(a => a.id === sid);
                    return ass ? sanitize(ass.titulo) : null;
                }).filter(Boolean);
                
                const vincText = vincs.length > 0 
                    ? '<div style="margin-top: 6px; font-size: 0.76rem; color: var(--green-700);"><i class="fas fa-link"></i> Vinculado a: ' + vincs.join(", ") + '</div>' 
                    : '<div style="margin-top: 6px; font-size: 0.76rem; color: var(--ink-muted);"><i class="fas fa-link-slash"></i> Sem vínculos</div>';
                
                const temXX = /X{2,}/.test(m.corpo || "");

                const corpoToggle = m.corpo 
                    ? '<div class="card-modelo-corpo-toggle" style="margin-top: 8px;">' +
                        '<button type="button" onclick="toggleCorpoCard(this)" style="background: none; border: none; color: var(--accent); font-size: 0.8rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px; padding: 0; outline: none;">' +
                            '<i class="fas fa-chevron-down"></i> Ver corpo do documento' +
                        '</button>' +
                        '<div class="modelo-corpo-completo" style="display: none; margin-top: 8px; background: var(--sand-200); padding: 12px; border-radius: var(--r-sm); font-size: 0.82rem; font-family: monospace; white-space: pre-wrap; color: var(--ink); border-left: 3px solid var(--accent); line-height: 1.5; max-height: 180px; overflow-y: auto;">' + sanitize(m.corpo) + '</div>' +
                      '</div>'
                    : '';

                return '<div class="card-assunto" style="border-color: var(--border); margin-bottom: 12px; animation: fadeUp .2s ease both;">' +
                    '<div class="card-top">' +
                        '<div class="card-cat"><i class="fas fa-file-invoice"></i> Modelo de Ofício</div>' +
                    '</div>' +
                    '<h3 class="card-titulo" style="font-size: 1.05rem;">' + sanitize(m.titulo) + '</h3>' +
                    (m.descricao ? '<p style="font-size: 0.85rem; color: var(--ink-muted); margin-bottom: 6px;">' + sanitize(m.descricao) + '</p>' : "") +
                    vincText +
                    corpoToggle +
                    '<div class="card-acoes" style="margin-top: 12px; display: flex; gap: 8px;">' +
                        '<button class="btn btn-primary btn-sm" onclick="abrirPreenchimentoModeloPorId(\'' + m.id + '\')"><i class="fas fa-file-pen"></i> ' + (temXX ? "Preencher e copiar" : "Copiar documento") + '</button>' +
                        '<button class="btn btn-ghost btn-icon btn-sm admin-only" onclick="editarModelo(\'' + m.id + '\')" title="Editar"><i class="fas fa-pencil"></i></button>' +
                        '<button class="btn btn-danger-ghost btn-icon btn-sm admin-only" onclick="removerModelo(\'' + m.id + '\', \'' + sanitize(m.titulo).replace(/'/g, "\\'") + '\')" title="Remover"><i class="fas fa-trash"></i></button>' +
                    '</div>' +
                '</div>';
            }).join("");
        }
    }

    // 2. Render para a aba de BUSCA DE OFÍCIO (Layout limpo, apenas cópia/preenchimento)
    if (elResultados) {
        if (modelos.length === 0) {
            const termoBusca = (document.getElementById("busca-modelos") ? document.getElementById("busca-modelos").value : "").trim();
            if (termoBusca) {
                elResultados.innerHTML = '<div class="empty"><i class="fas fa-magnifying-glass"></i><p>Nenhum modelo encontrado para "<strong>' + sanitize(termoBusca) + '</strong>".</p><button type="button" class="btn btn-ghost btn-sm" onclick="limparBuscaModelos()" style="margin-top: 10px;"><i class="fas fa-xmark"></i> Limpar busca</button></div>';
            } else {
                elResultados.innerHTML = '<div class="empty"><i class="fas fa-magnifying-glass"></i><p>Nenhum modelo cadastrado no sistema ainda.</p><button type="button" class="btn btn-ghost btn-sm admin-only" onclick="irPara(\'cadastro-oficio\')" style="margin-top: 10px;"><i class="fas fa-plus"></i> Cadastrar primeiro modelo</button></div>';
            }
        } else {
            elResultados.innerHTML = modelos.map(m => {
                const vincs = (m.assuntos_vinculados || []).map(sid => {
                    const ass = listaCache.find(a => a.id === sid);
                    return ass ? sanitize(ass.titulo) : null;
                }).filter(Boolean);
                
                const vincText = vincs.length > 0 
                    ? '<div style="margin-top: 6px; font-size: 0.76rem; color: var(--green-700);"><i class="fas fa-link"></i> Vinculado a: ' + vincs.join(", ") + '</div>' 
                    : '';
                
                const temXX = temVariaveis(m.corpo);

                const corpoToggle = m.corpo 
                    ? '<div class="card-modelo-corpo-toggle" style="margin-top: 8px;">' +
                        '<button type="button" onclick="toggleCorpoCard(this)" style="background: none; border: none; color: var(--accent); font-size: 0.8rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px; padding: 0; outline: none;">' +
                            '<i class="fas fa-chevron-down"></i> Ver corpo do documento' +
                        '</button>' +
                        '<div class="modelo-corpo-completo" style="display: none; margin-top: 8px; background: var(--sand-200); padding: 12px; border-radius: var(--r-sm); font-size: 0.82rem; font-family: monospace; white-space: pre-wrap; color: var(--ink); border-left: 3px solid var(--accent); line-height: 1.5; max-height: 180px; overflow-y: auto;">' + sanitize(m.corpo) + '</div>' +
                      '</div>'
                    : '';

                return '<div class="card-assunto" style="border-color: var(--border); margin-bottom: 12px; animation: fadeUp .2s ease both;">' +
                    '<div class="card-top">' +
                        '<div class="card-cat"><i class="fas fa-file-invoice"></i> Modelo de Ofício</div>' +
                    '</div>' +
                    '<h3 class="card-titulo" style="font-size: 1.05rem;">' + sanitize(m.titulo) + '</h3>' +
                    (m.descricao ? '<p style="font-size: 0.85rem; color: var(--ink-muted); margin-bottom: 6px;">' + sanitize(m.descricao) + '</p>' : "") +
                    vincText +
                    corpoToggle +
                    '<div class="card-acoes" style="margin-top: 12px;">' +
                        '<button class="btn btn-primary btn-sm" onclick="abrirPreenchimentoModeloPorId(\'' + m.id + '\')"><i class="fas fa-copy"></i> ' + (temXX ? "Preencher e copiar" : "Copiar documento") + '</button>' +
                    '</div>' +
                '</div>';
            }).join("");
        }
    }
}

function editarModelo(id) {
    const m = listaModelosCache.find(x => x.id === id);
    if (!m) return;
    document.getElementById("modelo-titulo").value = m.titulo || "";
    document.getElementById("modelo-descricao").value = m.descricao || "";
    document.getElementById("modelo-corpo").value = m.corpo || "";
    
    document.querySelectorAll('input[name="assunto-vinc"]').forEach(cb => {
        cb.checked = (m.assuntos_vinculados || []).includes(cb.value);
    });
    
    editandoModeloId = id;
    document.getElementById("btn-label-modelo-txt").textContent = "Salvar Alterações";
    const banner = document.getElementById("edit-mode-banner-modelo");
    if (banner) banner.style.display = "flex";
    
    document.getElementById("card-form-modelo").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function removerModelo(id, titulo) {
    if (!confirm('Remover o modelo "' + titulo + '"?\n\nEsta ação não pode ser desfeita.')) return;
    try {
        let removidoFirebase = false;
        if (modelosRef && !id.toString().startsWith("loc_")) {
            try {
                await modelosRef.doc(id).delete();
                toast("Modelo de ofício removido.");
                removidoFirebase = true;
            } catch (fbError) {
                console.warn("Erro ao remover do Firebase, tentando LocalStorage:", fbError);
            }
        }
        
        if (!removidoFirebase) {
            const local = lsGet(LS_MODELOS, []);
            lsSet(LS_MODELOS, local.filter(m => m.id !== id));
            toast("Modelo de ofício removido localmente.");
        }
        carregarModelos();
    } catch (error) {
        console.error("Erro ao remover modelo:", error);
        toast("Erro ao remover modelo.", "error");
    }
}

function buscarModelosDebounce() {
    clearTimeout(debounceTimerModelos);
    debounceTimerModelos = setTimeout(buscarModelos, 250);
    const limpar = document.getElementById("limpar-busca-modelos");
    if (limpar) limpar.style.display = document.getElementById("busca-modelos").value ? "flex" : "none";
}

function limparBuscaModelos() {
    document.getElementById("busca-modelos").value = "";
    document.getElementById("limpar-busca-modelos").style.display = "none";
    document.getElementById("busca-modelos").focus();
    renderListaModelos(listaModelosCache);
}

function buscarModelos() {
    const termo = document.getElementById("busca-modelos").value.trim().toLowerCase();
    if (!termo) { renderListaModelos(listaModelosCache); return; }
    
    const palavras = termo.split(/\s+/).filter(Boolean);
    const resultados = listaModelosCache.filter(m => {
        const tit = (m.titulo || "").toLowerCase();
        const desc = (m.descricao || "").toLowerCase();
        const corp = (m.corpo || "").toLowerCase();
        
        // Nomes dos assuntos vinculados a este modelo
        const vincs = (m.assuntos_vinculados || []).map(sid => {
            const ass = listaCache.find(a => a.id === sid);
            return ass ? (ass.titulo || "").toLowerCase() : "";
        }).filter(Boolean);

        return palavras.every(p => 
            tit.includes(p) || 
            desc.includes(p) || 
            corp.includes(p) ||
            vincs.some(v => v.includes(p))
        );
    });
    
    renderListaModelos(resultados);
}

function filtrarListaModelos() {
    const termo = (document.getElementById("filtro-lista-modelos-input") ? document.getElementById("filtro-lista-modelos-input").value : "").toLowerCase().trim();
    if (!termo) { renderListaModelos(listaModelosCache); return; }
    renderListaModelos(listaModelosCache.filter(m =>
        (m.titulo || "").toLowerCase().includes(termo) ||
        (m.descricao || "").toLowerCase().includes(termo)
    ));
}

let modalModeloAtual = null;
let modalModeloTrechos = [];

function abrirPreenchimentoModeloPorId(id) {
    const m = listaModelosCache.find(x => x.id === id);
    if (!m) { toast("Modelo não encontrado.", "error"); return; }
    abrirPreenchimentoModelo(m);
}

function abrirPreenchimentoModelo(m) {
    modalModeloAtual = m;
    const texto = m.corpo || "";
    modalModeloTrechos = [];
    const regex = obterRegexVariaveis();
    let ultimo = 0, match, idx = 0;
    const campos = [];
    
    while ((match = regex.exec(texto)) !== null) {
        modalModeloTrechos.push({ tipo: "texto", valor: texto.slice(ultimo, match.index) });
        modalModeloTrechos.push({ tipo: "campo", id: idx, original: match[0] });
        campos.push({ id: idx, original: match[0] });
        ultimo = match.index + match[0].length;
        idx++;
    }
    modalModeloTrechos.push({ tipo: "texto", valor: texto.slice(ultimo) });
    
    const contCampos = document.getElementById("modal-campos-modelo");
    if (campos.length === 0) {
        contCampos.innerHTML = '<div style="grid-column: span 2; text-align: center; color: var(--ink-muted); font-size: 0.9rem; padding: 12px 0;">Este modelo não possui variáveis para preencher.</div>';
    } else {
        contCampos.innerHTML = campos.map(c => 
            '<div class="modal-campo" style="margin-bottom: 8px;">' +
            '<label style="font-size: 0.72rem; font-weight:700; text-transform: uppercase;">Variável ' + (c.id + 1) + ' <span class="modal-campo-hint">(' + sanitize(c.original) + ')</span></label>' +
            '<input type="text" data-campo-modelo="' + c.id + '" oninput="atualizarPreviewModelo()" placeholder="Preencha o valor..." style="padding: 8px 12px; font-size: 0.88rem; width: 100%;" autocomplete="off">' +
            '</div>'
        ).join("");
    }
    
    document.getElementById("modal-titulo-modelo").textContent = m.titulo;
    atualizarPreviewModelo();
    document.getElementById("modal-preencher-modelo").style.display = "flex";
    
    setTimeout(() => {
        const firstInput = contCampos.querySelector("input");
        if (firstInput) firstInput.focus();
    }, 100);
}

function atualizarPreviewModelo() {
    const valores = {};
    document.querySelectorAll("[data-campo-modelo]").forEach(inp => {
        valores[inp.dataset.campoModelo] = inp.value;
    });
    
    let html = "", textoFinal = "";
    modalModeloTrechos.forEach(t => {
        if (t.tipo === "texto") {
            html += sanitize(t.valor);
            textoFinal += t.valor;
        } else {
            const rawVal = valores[t.id];
            const v = processarValorCampo(rawVal, t.original);
            if (v) {
                html += '<mark>' + sanitize(v) + '</mark>';
                textoFinal += v;
            } else {
                html += '<span class="ph">' + sanitize(t.original) + '</span>';
                textoFinal += t.original;
            }
        }
    });
    
    document.getElementById("modal-preview-modelo").innerHTML = html;
    document.getElementById("modal-preencher-modelo").dataset.textoFinal = textoFinal;
}

function confirmarPreenchimentoModelo() {
    const texto = document.getElementById("modal-preencher-modelo").dataset.textoFinal;
    copiarTextoModelo(texto, modalModeloAtual);
    fecharModalModelo();
}

function copiarModeloSemPreencher() {
    copiarTextoModelo(modalModeloAtual.corpo, modalModeloAtual);
    fecharModalModelo();
}

function fecharModalModelo() {
    document.getElementById("modal-preencher-modelo").style.display = "none";
    modalModeloAtual = null;
}

function copiarTextoModelo(texto, modelo) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(texto).then(() => {
            toast("Modelo de ofício copiado!");
            registrarUsoModelo(modelo, texto);
        }).catch(() => fallbackCopiarModelo(texto, modelo));
    } else {
        fallbackCopiarModelo(texto, modelo);
    }
}

function fallbackCopiarModelo(texto, modelo) {
    const ta = document.createElement("textarea");
    ta.value = texto; document.body.appendChild(ta); ta.select();
    try {
        document.execCommand("copy");
        toast("Modelo de ofício copiado!");
        registrarUsoModelo(modelo, texto);
    } catch {
        toast("Não foi possível copiar.", "error");
    }
    document.body.removeChild(ta);
}

function registrarUsoModelo(modelo, textoFinal) {
    historico.unshift({ texto: textoFinal, titulo: "[Modelo] " + modelo.titulo, data: Date.now() });
    historico = historico.slice(0, 20);
    lsSet(LS_HIST, historico);
    atualizarBadgeHistorico();
}

function toggleCorpoCard(btn) {
    const container = btn.nextElementSibling;
    const icon = btn.querySelector("i");
    if (container.style.display === "none") {
        container.style.display = "block";
        icon.className = "fas fa-chevron-up";
        btn.innerHTML = '<i class="fas fa-chevron-up"></i> Ocultar corpo do documento';
    } else {
        container.style.display = "none";
        icon.className = "fas fa-chevron-down";
        btn.innerHTML = '<i class="fas fa-chevron-down"></i> Ver corpo do documento';
    }
}

// INICIALIZACAO
window.addEventListener("load", () => {
    limparDadosExemploLocais();
    atualizarBadgeHistorico();
    atualizarUIAdmin();
    document.addEventListener("keydown", (e) => {
        if (e.key === "/" && !["INPUT","TEXTAREA"].includes(document.activeElement.tagName)) {
            e.preventDefault();
            irPara("buscar");
        }
        if (e.key === "Escape") { fecharModal(); fecharModalModelo(); fecharHistorico(); fecharModalAdmin(); fecharModalEndereco(); }
    });
    carregarAssuntos();
    carregarModelos();
    carregarPronomes();

    if (auth) {
        auth.onAuthStateChanged((user) => { 
            if (user) { 
                carregarAssuntos(); 
                carregarModelos();
                carregarPronomes();
            } 
        });
    }
});

// ═══════════════════════════════════════════════════════════════
//  MÓDULO: ADMINISTRADOR (ADMIN)
// ═══════════════════════════════════════════════════════════════
const LS_ADMIN_PASS = "ga_admin_pass";
const SS_IS_ADMIN    = "ga_is_admin";

function ehAdmin() {
    return sessionStorage.getItem(SS_IS_ADMIN) === "true";
}

function obterSenhaAdmin() {
    return localStorage.getItem(LS_ADMIN_PASS) || "admin123";
}

function atualizarUIAdmin() {
    const isAdm = ehAdmin();
    document.body.classList.toggle("modo-admin", isAdm);
    
    const btnStatus = document.getElementById("btn-admin-status");
    const txtStatus = document.getElementById("txt-admin-status");
    const icone = document.getElementById("icone-admin-status");
    
    if (btnStatus && txtStatus) {
        if (isAdm) {
            btnStatus.classList.add("admin-ativo");
            txtStatus.textContent = "Admin (Sair)";
            if (icone) icone.className = "fas fa-user-shield";
            btnStatus.title = "Clique para sair do modo Administrador";
        } else {
            btnStatus.classList.remove("admin-ativo");
            txtStatus.textContent = "Admin";
            if (icone) icone.className = "fas fa-lock";
            btnStatus.title = "Clique para entrar no modo Administrador";
        }
    }
}

function clicarAdmin() {
    abrirModalAdmin();
}

function abrirModalAdmin() {
    const modal = document.getElementById("modal-admin");
    if (!modal) return;
    document.getElementById("senha-admin").value = "";
    const err = document.getElementById("erro-senha-admin");
    if (err) err.style.display = "none";
    
    const painelLogin = document.getElementById("admin-painel-login");
    const painelLogado = document.getElementById("admin-painel-logado");
    if (ehAdmin()) {
        if (painelLogin) painelLogin.style.display = "none";
        if (painelLogado) painelLogado.style.display = "block";
    } else {
        if (painelLogin) painelLogin.style.display = "block";
        if (painelLogado) painelLogado.style.display = "none";
    }
    
    modal.classList.add("aberto");
    modal.style.display = "flex";
    setTimeout(() => {
        const inp = document.getElementById("senha-admin");
        if (inp && !ehAdmin()) inp.focus();
    }, 100);
}

function fecharModalAdmin() {
    const modal = document.getElementById("modal-admin");
    if (modal) {
        modal.classList.remove("aberto");
        modal.style.display = "none";
    }
}

function validarLoginAdmin(e) {
    if (e) e.preventDefault();
    const inputSenha = document.getElementById("senha-admin");
    const senhaDigitada = inputSenha ? inputSenha.value.trim() : "";
    const senhaCorreta = obterSenhaAdmin();
    
    if (senhaDigitada === senhaCorreta) {
        sessionStorage.setItem(SS_IS_ADMIN, "true");
        atualizarUIAdmin();
        fecharModalAdmin();
        toast("Modo Administrador ativado!");
    } else {
        const err = document.getElementById("erro-senha-admin");
        if (err) err.style.display = "block";
        if (inputSenha) { inputSenha.focus(); inputSenha.select(); }
    }
}

function logoutAdmin() {
    sessionStorage.removeItem(SS_IS_ADMIN);
    atualizarUIAdmin();
    toast("Você saiu do modo Administrador.", "info");
    const telaAtivaBtn = document.querySelector(".nav-btn.ativo");
    const telaAtual = telaAtivaBtn ? telaAtivaBtn.dataset.tela : null;
    if (telaAtual === "gerenciar" || telaAtual === "cadastro-oficio") {
        irPara("buscar");
    }
}

function alterarSenhaAdmin(e) {
    if (e) e.preventDefault();
    const atual = document.getElementById("senha-atual").value.trim();
    const nova = document.getElementById("nova-senha").value.trim();
    const confirma = document.getElementById("confirma-senha").value.trim();
    const err = document.getElementById("erro-alterar-senha");
    
    if (atual !== obterSenhaAdmin()) {
        if (err) { err.textContent = "Senha atual incorreta."; err.style.display = "block"; }
        return;
    }
    if (!nova || nova.length < 4) {
        if (err) { err.textContent = "A nova senha deve ter pelo menos 4 caracteres."; err.style.display = "block"; }
        return;
    }
    if (nova !== confirma) {
        if (err) { err.textContent = "As senhas digitadas não coincidem."; err.style.display = "block"; }
        return;
    }
    
    localStorage.setItem(LS_ADMIN_PASS, nova);
    toast("Senha de Administrador alterada!");
    fecharModalAdmin();
}

function toggleMostrarSenha(inputId, iconeId) {
    const inp = document.getElementById(inputId || "senha-admin");
    const ico = document.getElementById(iconeId || "icone-ver-senha-1");
    if (!inp) return;
    if (inp.type === "password") {
        inp.type = "text";
        if (ico) ico.className = "fas fa-eye-slash";
    } else {
        inp.type = "password";
        if (ico) ico.className = "fas fa-eye";
    }
}

// ═══════════════════════════════════════════════════════════════
//  VARREDURA COMPLETA DE DADOS (FIREBASE + LOCALSTORAGE)
// ═══════════════════════════════════════════════════════════════
async function varreduraCompletaDados() {
    toast("Realizando varredura completa por modelos e assuntos...", "info");
    const mapaModelos = new Map();
    const mapaAssuntos = new Map();

    // 1. Varredura no LocalStorage
    ["ga_modelos", "modelos", "modelos_oficio", "oficios"].forEach(key => {
        const itens = lsGet(key, []);
        if (Array.isArray(itens)) {
            itens.forEach(m => { if (m && (m.titulo || m.corpo)) mapaModelos.set(m.id || ("loc_" + Math.random()), m); });
        }
    });

    ["ga_assuntos", "assuntos", "lista_assuntos"].forEach(key => {
        const itens = lsGet(key, []);
        if (Array.isArray(itens)) {
            itens.forEach(a => { if (a && (a.titulo || a.descricao)) mapaAssuntos.set(a.id || ("loc_" + Math.random()), a); });
        }
    });

    // 2. Varredura nas coleções do Firestore
    if (db) {
        const colecoesModelos = ["modelos_oficio", "modelos", "oficios"];
        for (const col of colecoesModelos) {
            try {
                const snap = await db.collection(col).limit(LIMITE).get();
                snap.forEach(doc => {
                    const data = doc.data();
                    if (data && (data.titulo || data.corpo)) mapaModelos.set(doc.id, Object.assign({ id: doc.id }, data));
                });
            } catch (err) {}
        }

        const colecoesAssuntos = ["assuntos", "gerador_assuntos"];
        for (const col of colecoesAssuntos) {
            try {
                const snap = await db.collection(col).limit(LIMITE).get();
                snap.forEach(doc => {
                    const data = doc.data();
                    if (data && (data.titulo || data.descricao)) mapaAssuntos.set(doc.id, Object.assign({ id: doc.id }, data));
                });
            } catch (err) {}
        }
    }

    // 3. Atualiza listaCache
    listaCache = Array.from(mapaAssuntos.values());

    // 4. Se não houver modelos de ofício cadastrados, garante os modelos de documento oficiais padrão
    const modelosIniciais = garantirModelosIniciais();
    modelosIniciais.forEach(m => { if (!mapaModelos.has(m.id)) mapaModelos.set(m.id, m); });

    listaModelosCache = Array.from(mapaModelos.values());

    categoriasCache.clear();
    listaCache.forEach(a => { if (a.categoria) categoriasCache.add(a.categoria); });

    atualizarContadorModelos(listaModelosCache.length);
    atualizarContador(listaCache.length);
    atualizarDatalist();

    renderListaModelos(listaModelosCache);
    if (document.getElementById("tela-gerenciar")?.classList.contains("ativa")) filtrarLista();
    if (document.getElementById("tela-buscar")?.classList.contains("ativa")) renderInicio();

    toast(`Varredura concluída: ${listaCache.length} assuntos e ${listaModelosCache.length} modelos unificados!`);
}

// ═══════════════════════════════════════════════════════════
//  MÓDULO: ENDEREÇAMENTOS
// ═══════════════════════════════════════════════════════════

function calcularEnderecoPreview() {
    const tipo = document.getElementById("e-tipo-doc").value;
    const tratamento = document.getElementById("e-tratamento").value.trim();
    const destinatario = document.getElementById("e-destinatario").value.trim();
    const cargo = document.getElementById("e-cargo").value.trim();
    const orgao = document.getElementById("e-orgao").value.trim();
    const localidade = document.getElementById("e-localidade").value.trim();
    const vocativo = document.getElementById("e-vocativo").value.trim();
    
    let result = "";
    if (tipo === "oficio") {
        if (tratamento) result += tratamento + "\n";
        if (destinatario) result += destinatario + "\n";
        if (cargo) result += cargo + "\n";
        if (orgao) result += orgao + "\n";
        if (localidade) result += localidade;
        if (vocativo) result += "\n\n" + vocativo;
    } else if (tipo === "circular") {
        if (tratamento) result += tratamento + "\n";
        if (cargo) result += cargo + "\n";
        if (orgao) result += orgao + "\n";
        if (localidade) result += localidade;
        if (vocativo) result += "\n\n" + vocativo;
    } else {
        if (vocativo) {
            result += vocativo + "\n\n";
        } else {
            if (destinatario) result += "Prezado(a) " + destinatario + ",\n\n";
        }
        if (cargo) result += cargo + "\n";
        if (orgao) result += orgao + "\n";
    }
    
    document.getElementById("endereco-preview-box").innerText = result || "Preencha os campos para visualizar...";
    return result;
}

function atualizarCamposEPreview() {
    const tipo = document.getElementById("e-tipo-doc").value;
    const groupTratamento = document.getElementById("group-e-tratamento");
    const rowVocativo = document.getElementById("row-e-vocativo");
    const groupDestinatario = document.getElementById("group-e-destinatario");
    const labelDestinatario = document.getElementById("label-e-destinatario");
    const inputDestinatario = document.getElementById("e-destinatario");
    const groupCargo = document.getElementById("group-e-cargo");
    const labelCargo = groupCargo.querySelector("label");
    const inputCargo = document.getElementById("e-cargo");
    
    groupTratamento.style.display = "block";
    rowVocativo.style.display = "grid";
    groupDestinatario.style.display = "block";
    groupCargo.style.display = "block";
    labelDestinatario.innerHTML = 'Autoridade Destinatária <span class="obrig">*</span>';
    inputDestinatario.placeholder = 'Ex: Doutor EDUARDO PEREZ OLIVEIRA';
    labelCargo.innerHTML = 'Cargo / Função <span class="obrig">*</span>';
    inputCargo.placeholder = 'Ex: Juiz de Direito e Coordenador do NATJUS';
    
    if (tipo === "circular") {
        groupDestinatario.style.display = "none";
        labelCargo.innerHTML = 'Destinatários Coletivos <span class="obrig">*</span>';
        inputCargo.placeholder = 'Ex: Senhores Magistrados, Diretores de Foro e Chefes de Secretaria';
    } else if (tipo === "email") {
        groupTratamento.style.display = "none";
        labelDestinatario.innerHTML = 'Nome do Destinatário <span class="obrig">*</span>';
        inputDestinatario.placeholder = 'Ex: Eduardo Perez Oliveira';
        labelCargo.innerHTML = 'Cargo / Função';
    }
    
    calcularEnderecoPreview();
}

function copiarPreviewEndereco() {
    const text = calcularEnderecoPreview();
    if (!text || text === "Preencha os campos para visualizar...") {
        toast("Preencha os dados do endereçamento primeiro.", "error");
        return;
    }
    
    const ta = document.createElement("textarea");
    ta.style.position = "fixed"; ta.style.opacity = "0";
    ta.value = text; document.body.appendChild(ta); ta.select();
    try {
        document.execCommand("copy");
        toast("Endereçamento copiado!");
    } catch {
        toast("Não foi possível copiar.", "error");
    }
    document.body.removeChild(ta);
}

function novoEnderecamento() {
    document.getElementById("e-id").value = "";
    document.getElementById("e-tipo-doc").value = "oficio";
    document.getElementById("e-tratamento").value = "A Sua Excelência o Senhor";
    document.getElementById("e-vocativo").value = "";
    document.getElementById("e-destinatario").value = "";
    document.getElementById("e-cargo").value = "";
    document.getElementById("e-orgao").value = "Tribunal de Justiça do Estado de Goiás";
    document.getElementById("e-localidade").value = "N E S T A";
    document.getElementById("e-obs").value = "";
    document.getElementById("e-novo-pronome-val").value = "";
    document.getElementById("e-novo-vocativo-val").value = "";
    
    document.getElementById("cad-end-titulo").textContent = "Novo Endereçamento";
    document.getElementById("cad-end-sub").textContent = "Configure os dados para a geração automática do bloco formal";
    
    document.getElementById("err-e-tratamento").textContent = "";
    document.getElementById("err-e-vocativo").textContent = "";
    document.getElementById("err-e-destinatario").textContent = "";
    document.getElementById("err-e-cargo").textContent = "";
    document.getElementById("err-e-orgao").textContent = "";
    document.getElementById("err-e-localidade").textContent = "";
    
    atualizarCamposEPreview();
    irPara("cadastro-endereco");
}

async function salvarEnderecamento() {
    const id = document.getElementById("e-id").value;
    const tipoDoc = document.getElementById("e-tipo-doc").value;
    const tratamento = tipoDoc === "email" ? "" : document.getElementById("e-tratamento").value.trim();
    const vocativo = document.getElementById("e-vocativo").value.trim();
    const destinatario = tipoDoc === "circular" ? "" : document.getElementById("e-destinatario").value.trim();
    const cargo = document.getElementById("e-cargo").value.trim();
    const orgao = document.getElementById("e-orgao").value.trim();
    const localidade = document.getElementById("e-localidade").value.trim();
    const obs = document.getElementById("e-obs").value.trim();
    const textoGerado = calcularEnderecoPreview();
    
    let ok = true;
    
    if (tipoDoc !== "email") {
        if (!tratamento) { document.getElementById("err-e-tratamento").textContent = "Campo obrigatório."; ok = false; } else document.getElementById("err-e-tratamento").textContent = "";
    }
    
    if (!vocativo) { document.getElementById("err-e-vocativo").textContent = "Campo obrigatório."; ok = false; } else document.getElementById("err-e-vocativo").textContent = "";
    
    if (tipoDoc !== "circular") {
        if (!destinatario) { document.getElementById("err-e-destinatario").textContent = "Campo obrigatório."; ok = false; } else document.getElementById("err-e-destinatario").textContent = "";
    }
    
    if (!cargo) { document.getElementById("err-e-cargo").textContent = "Campo obrigatório."; ok = false; } else document.getElementById("err-e-cargo").textContent = "";
    if (!orgao) { document.getElementById("err-e-orgao").textContent = "Campo obrigatório."; ok = false; } else document.getElementById("err-e-orgao").textContent = "";
    if (!localidade) { document.getElementById("err-e-localidade").textContent = "Campo obrigatório."; ok = false; } else document.getElementById("err-e-localidade").textContent = "";
    
    if (!ok) return;
    
    const dadosBase = {
        tipoDoc, tratamento, vocativo, destinatario, cargo, orgao, localidade, obs, textoGerado
    };
    
    try {
        if (id) {
            await enderecamentosRef.doc(id).update(dadosBase);
            toast("Endereçamento atualizado!");
        } else {
            await enderecamentosRef.add(Object.assign({}, dadosBase, { criadoEm: firebase.firestore.FieldValue.serverTimestamp() }));
            toast("Endereçamento cadastrado!");
        }
        irPara("enderecos");
    } catch(e) {
        console.error("Erro ao salvar endereçamento:", e);
        toast("Erro ao salvar.", "error");
    }
}

async function carregarEnderecamentos() {
    const el = document.getElementById("resultados_enderecos");
    if (el) el.innerHTML = '<div class="empty"><i class="fas fa-spinner fa-spin"></i><p>Carregando endereçamentos...</p></div>';
    
    try {
        const snap = await enderecamentosRef.get();
        todosEnderecamentos = snap.docs
            .filter(doc => doc.id !== "config_pronomes")
            .map(doc => {
                const d = doc.data();
                return Object.assign({ id: doc.id }, d, { criadoEm: d.criadoEm ? d.criadoEm.toMillis() : 0 });
            });
        todosEnderecamentos.sort((a,b) => b.criadoEm - a.criadoEm);
        renderEnderecamentos();
    } catch(e) {
        console.error("Erro ao carregar endereçamentos:", e);
        if (el) el.innerHTML = '<div class="empty"><i class="fas fa-circle-exclamation" style="color:var(--danger);"></i><p>Erro de conexão com o banco de dados.</p></div>';
    }
}

function renderEnderecamentos() {
    const el = document.getElementById("resultados_enderecos");
    if (!el) return;
    
    const busca = (document.getElementById("busca-enderecos")?.value || "").toLowerCase();
    let lista = [...todosEnderecamentos];
    
    if (busca) {
        lista = lista.filter(e => 
            (e.orgao && e.orgao.toLowerCase().includes(busca)) || 
            (e.destinatario && e.destinatario.toLowerCase().includes(busca)) ||
            (e.cargo && e.cargo.toLowerCase().includes(busca)) ||
            (e.vocativo && e.vocativo.toLowerCase().includes(busca))
        );
    }
    
    if (filtroEnderecosAtual !== "todos") {
        lista = lista.filter(e => e.tipoDoc === filtroEnderecosAtual);
    }
    
    if (lista.length === 0) {
        el.innerHTML = '<div class="empty"><i class="fas fa-magnifying-glass"></i><p>Nenhum endereço encontrado.</p></div>';
        return;
    }
    
    el.innerHTML = lista.map(e => {
        let icon = "file-lines";
        let labelTipo = "Ofício";
        let classTipo = "badge-oficio";
        if (e.tipoDoc === "email") {
            icon = "envelope";
            labelTipo = "E-mail";
            classTipo = "badge-email";
        } else if (e.tipoDoc === "circular") {
            icon = "bullhorn";
            labelTipo = "Circular";
            classTipo = "badge-circular";
        }
        
        const badgeTipo = '<span class="badge-tipo ' + classTipo + '"><i class="fas ' + icon + '"></i> ' + labelTipo + '</span>';
        const destinatarioLabel = e.tipoDoc === "circular" ? "Circular Geral" : (e.destinatario || "-");
        
        return '<div class="card-assunto" style="border-color: var(--border); margin-bottom: 12px;">' +
            '<div class="card-top">' +
                '<div class="card-cat"><i class="fas fa-map-location-dot"></i> ' + badgeTipo + '</div>' +
            '</div>' +
            '<h3 class="card-titulo" style="margin-bottom: 4px;">' + sanitize(e.orgao) + '</h3>' +
            (e.tipoDoc !== "circular" ? '<p style="font-size: 0.85rem; color: var(--ink-muted); margin-bottom: 6px;">' + sanitize(destinatarioLabel) + '</p>' : "") +
            '<div class="card-assunto-texto" style="font-family: monospace; font-size: 0.85rem; line-height: 1.4; max-height: 120px; overflow-y: auto; white-space: pre-wrap; margin-bottom: 12px; font-style: normal; background: var(--sand-200); padding: 12px; border-radius: var(--r-sm); border-left: 3px solid var(--accent); color: var(--ink);">' + sanitize(e.textoGerado) + '</div>' +
            '<div class="card-acoes" style="display:flex; justify-content:space-between; width:100%;">' +
                '<div style="display:flex; gap:8px;">' +
                    '<button type="button" class="btn btn-primary btn-sm" onclick="copiarTextoEndereco(this, \'' + e.id + '\')"><i class="fas fa-copy"></i> Copiar Bloco</button>' +
                    '<button type="button" class="btn btn-outline btn-sm" onclick="verEnderecamento(\'' + e.id + '\')"><i class="fas fa-eye"></i> Detalhes</button>' +
                '</div>' +
                '<div class="admin-only" style="display:flex; gap:8px;">' +
                    '<button type="button" class="btn btn-outline btn-sm" onclick="editarEnderecamento(\'' + e.id + '\')" style="color:var(--accent);"><i class="fas fa-pen"></i></button>' +
                    '<button type="button" class="btn btn-outline btn-sm" onclick="confirmarExcluirEndereco(\'' + e.id + '\', \'' + e.orgao.replace(/'/g, "\\'") + '\')" style="color:var(--danger); border-color:rgba(179,48,48,0.3);"><i class="fas fa-trash"></i></button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }).join("");
}

function buscarEnderecosDebounce() {
    clearTimeout(debounceEnderecosTimer);
    debounceEnderecosTimer = setTimeout(renderEnderecamentos, 250);
    const limpar = document.getElementById("limpar-busca-enderecos");
    if (limpar) limpar.style.display = document.getElementById("busca-enderecos").value ? "flex" : "none";
}

function limparBuscaEnderecos() {
    document.getElementById("busca-enderecos").value = "";
    document.getElementById("limpar-busca-enderecos").style.display = "none";
    document.getElementById("busca-enderecos").focus();
    renderEnderecamentos();
}

function setFiltroEnderecos(tipo, btn) {
    filtroEnderecosAtual = tipo;
    btn.parentNode.querySelectorAll(".cat-chip").forEach(b => b.classList.remove("ativo"));
    btn.classList.add("ativo");
    renderEnderecamentos();
}

function copiarTextoEndereco(btn, id) {
    const e = todosEnderecamentos.find(x => x.id === id);
    if (!e) return;
    
    const ta = document.createElement("textarea");
    ta.style.position = "fixed"; ta.style.opacity = "0";
    ta.value = e.textoGerado; document.body.appendChild(ta); ta.select();
    try {
        document.execCommand("copy");
        toast("Endereçamento copiado!");
        const icon = btn.querySelector("i");
        const oldClass = icon.className;
        icon.className = "fas fa-check";
        setTimeout(() => { icon.className = oldClass; }, 1800);
    } catch {
        toast("Não foi possível copiar.", "error");
    }
    document.body.removeChild(ta);
}

function verEnderecamento(id) {
    const e = todosEnderecamentos.find(x => x.id === id);
    if (!e) return;
    
    let labelTipo = e.tipoDoc === "oficio" ? "Ofício Individual" : e.tipoDoc === "email" ? "E-mail" : "Ofício Circular";
    
    document.getElementById("modal-ver-endereco-body").innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:0.88rem;">
            <div><strong>Órgão / Instituição:</strong><div style="color:var(--ink-muted); margin-top:2px;">${sanitize(e.orgao)}</div></div>
            <div><strong>Tipo de Documento:</strong><div style="color:var(--ink-muted); margin-top:2px;">${labelTipo}</div></div>
            ${e.vocativo ? `<div><strong>Vocativo:</strong><div style="color:var(--ink-muted); margin-top:2px;">${sanitize(e.vocativo)}</div></div>` : ""}
        </div>
        <div style="margin-top:8px;">
            <strong>Bloco de Endereçamento Oficial:</strong>
            <div style="background:var(--sand-200); border-left:3px solid var(--accent); border-radius:0 var(--r-sm) var(--r-sm) 0; padding:12px; font-family:monospace; font-size:0.85rem; line-height:1.4; color:var(--ink); white-space:pre-wrap; max-height:160px; overflow-y:auto; margin-top:6px;">${sanitize(e.textoGerado)}</div>
        </div>
        ${e.obs ? `<div style="margin-top:4px;"><strong>Observações:</strong><div style="background:var(--sand-200); padding:10px; border-radius:var(--r-sm); font-size:0.82rem; color:var(--ink-muted); margin-top:4px; font-style:italic;">${sanitize(e.obs)}</div></div>` : ""}
    `;
    
    document.getElementById("modal-ver-endereco-footer").innerHTML = `
        <button class="btn btn-ghost" onclick="fecharModalEndereco()">Fechar</button>
        <button class="btn btn-primary" onclick="copiarModalEndereco('${e.id}')"><i class="fas fa-copy"></i> Copiar Bloco</button>
    `;
    
    const m = document.getElementById("modal-ver-endereco");
    m.style.display = "flex";
}

function fecharModalEndereco() {
    document.getElementById("modal-ver-endereco").style.display = "none";
}

function copiarModalEndereco(id) {
    const e = todosEnderecamentos.find(x => x.id === id);
    if (!e) return;
    const ta = document.createElement("textarea");
    ta.style.position = "fixed"; ta.style.opacity = "0";
    ta.value = e.textoGerado; document.body.appendChild(ta); ta.select();
    try {
        document.execCommand("copy");
        toast("Endereçamento copiado!");
        fecharModalEndereco();
    } catch {
        toast("Não foi possível copiar.", "error");
    }
    document.body.removeChild(ta);
}

function editarEnderecamento(id) {
    const e = todosEnderecamentos.find(x => x.id === id);
    if (!e) return;
    
    document.getElementById("e-id").value = id;
    document.getElementById("e-tipo-doc").value = e.tipoDoc;
    document.getElementById("e-tratamento").value = e.tratamento || "";
    document.getElementById("e-vocativo").value = e.vocativo || "";
    document.getElementById("e-destinatario").value = e.destinatario || "";
    document.getElementById("e-cargo").value = e.cargo || "";
    document.getElementById("e-orgao").value = e.orgao || "";
    document.getElementById("e-localidade").value = e.localidade || "";
    document.getElementById("e-obs").value = e.obs || "";
    document.getElementById("e-novo-pronome-val").value = "";
    document.getElementById("e-novo-vocativo-val").value = "";
    
    document.getElementById("cad-end-titulo").textContent = "Editar Endereçamento";
    document.getElementById("cad-end-sub").textContent = "Altere os parâmetros do endereçamento";
    
    document.getElementById("err-e-tratamento").textContent = "";
    document.getElementById("err-e-vocativo").textContent = "";
    document.getElementById("err-e-destinatario").textContent = "";
    document.getElementById("err-e-cargo").textContent = "";
    document.getElementById("err-e-orgao").textContent = "";
    document.getElementById("err-e-localidade").textContent = "";
    
    atualizarCamposEPreview();
    irPara("cadastro-endereco");
}

async function confirmarExcluirEndereco(id, orgao) {
    if (!confirm('Deseja excluir permanentemente o endereçamento de "' + orgao + '"?')) return;
    try {
        await enderecamentosRef.doc(id).delete();
        toast("Endereçamento removido.");
        await carregarEnderecamentos();
    } catch (error) {
        console.error("Erro ao remover:", error);
        toast("Erro ao remover.", "error");
    }
}

async function adicionarNovoPronome() {
    const val = document.getElementById("e-novo-pronome-val").value.trim();
    if (!val) {
        toast("Digite o pronome de tratamento.", "error");
        return;
    }
    try {
        let customPronomes = lsGet(LS_PRONOMES, []);
        if (!customPronomes.includes(val)) {
            customPronomes.push(val);
            lsSet(LS_PRONOMES, customPronomes);
        }
        toast("Pronome de tratamento cadastrado!");
        document.getElementById("e-novo-pronome-val").value = "";
        await carregarPronomes();
    } catch(e) {
        console.error("Erro ao cadastrar pronome:", e);
        toast("Erro ao cadastrar pronome.", "error");
    }
}

async function adicionarNovoVocativo() {
    const val = document.getElementById("e-novo-vocativo-val").value.trim();
    if (!val) {
        toast("Digite o vocativo.", "error");
        return;
    }
    try {
        let customVocativos = lsGet(LS_VOCATIVOS, []);
        if (!customVocativos.includes(val)) {
            customVocativos.push(val);
            lsSet(LS_VOCATIVOS, customVocativos);
        }
        toast("Vocativo cadastrado!");
        document.getElementById("e-novo-vocativo-val").value = "";
        await carregarPronomes();
    } catch(e) {
        console.error("Erro ao cadastrar vocativo:", e);
        toast("Erro ao cadastrar vocativo.", "error");
    }
}

async function carregarPronomes() {
    try {
        let customPronomes = lsGet(LS_PRONOMES, []);
        let customVocativos = lsGet(LS_VOCATIVOS, []);
        
        const padroesP = [
            "A Sua Excelência o Senhor",
            "A Sua Senhoria o Senhor",
            "Ao Senhor",
            "Excelentíssimo Senhor Juiz"
        ];
        
        const padroesV = [
            "Excelentíssimo Senhor Juiz,",
            "Senhor Coordenador,",
            "Senhor Comandante-Geral,",
            "Senhora Candidata,",
            "Prezada Senhora,",
            "Prezado Senhor,"
        ];
        
        let lista = Array.from(new Set([...padroesP, ...customPronomes]));
        let vocativos = Array.from(new Set([...padroesV, ...customVocativos]));
        
        lista.sort((a, b) => a.localeCompare(b));
        vocativos.sort((a, b) => a.localeCompare(b));
        
        todosPronomes = lista;
        todosVocativos = vocativos;
        
        const dlP = document.getElementById("pronomes-lista");
        if (dlP) {
            dlP.innerHTML = todosPronomes.map(p => `<option value="${sanitize(p)}">`).join("");
        }
        const dlV = document.getElementById("vocativos-lista");
        if (dlV) {
            dlV.innerHTML = todosVocativos.map(v => `<option value="${sanitize(v)}">`).join("");
        }
    } catch(e) {
        console.error("Erro ao carregar pronomes e vocativos:", e);
    }
}
