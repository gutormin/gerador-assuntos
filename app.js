// CONFIGURAÇÃO FIREBASE - SUBSTITUA COM SUAS CONFIGURAÇÕES
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "seuprojeto.firebaseapp.com",
  projectId: "seuprojeto",
  storageBucket: "seuprojeto.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123..."
};

// Inicializar Firebase
try {
    firebase.initializeApp(firebaseConfig);
    console.log("Firebase inicializado!");
} catch (error) {
    console.error("Erro ao inicializar Firebase:", error);
    alert("Configure o Firebase primeiro! Veja instruções na página.");
}

const db = firebase.firestore();
const assuntosRef = db.collection("assuntos");

// Função para cadastrar assunto
async function cadastrarAssunto() {
    const titulo = document.getElementById('titulo').value;
    const palavras_chave = document.getElementById('palavras_chave').value;
    const categoria = document.getElementById('categoria').value;
    const descricao = document.getElementById('descricao').value;

    if (!titulo || !palavras_chave) {
        alert('Por favor, preencha título e palavras-chave!');
        return;
    }

    // Processar palavras-chave
    const palavrasArray = palavras_chave.split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0);

    // Criar objeto do assunto
    const assunto = {
        titulo: titulo,
        palavras_chave: palavrasArray,
        categoria: categoria || "geral",
        descricao: descricao || "",
        data_cadastro: new Date()
    };

    try {
        await assuntosRef.add(assunto);
        alert('Assunto cadastrado com sucesso!');
        limparFormulario();
        carregarAssuntosCadastrados();
    } catch (error) {
        console.error('Erro ao cadastrar:', error);
        alert('Erro ao cadastrar assunto!');
    }
}

// Limpar formulário após cadastro
function limparFormulario() {
    document.getElementById('titulo').value = '';
    document.getElementById('palavras_chave').value = '';
    document.getElementById('categoria').value = '';
    document.getElementById('descricao').value = '';
}

// Função principal de busca
async function buscarAssuntos() {
    const textoBusca = document.getElementById('busca').value.toLowerCase().trim();
    
    if (!textoBusca) {
        alert('Digite alguma palavra para buscar!');
        return;
    }

    // Dividir palavras da busca
    const palavrasBusca = textoBusca.split(' ')
        .map(p => p.trim())
        .filter(p => p.length > 2); // Ignorar palavras muito curtas

    const resultadosElemento = document.getElementById('resultados');
    resultadosElemento.innerHTML = '<div class="loading">Buscando assuntos...</div>';

    try {
        // Buscar todos assuntos
        const snapshot = await assuntosRef.get();
        const assuntos = [];

        snapshot.forEach(doc => {
            const assunto = doc.data();
            assunto.id = doc.id;
            
            // Calcular relevância
            const relevancia = calcularRelevancia(assunto.palavras_chave, palavrasBusca);
            
            if (relevancia > 0) {
                assuntos.push({
                    ...assunto,
                    relevancia: relevancia
                });
            }
        });

        // Ordenar por relevância
        assuntos.sort((a, b) => b.relevancia - a.relevancia);

        // Mostrar resultados
        mostrarResultados(assuntos, palavrasBusca);
    } catch (error) {
        console.error('Erro na busca:', error);
        resultadosElemento.innerHTML = '<div class="warning">Erro ao buscar assuntos!</div>';
    }
}

// Algoritmo de cálculo de relevância
function calcularRelevancia(palavrasAssunto, palavrasBusca) {
    let pontos = 0;
    
    for (const palavraBusca of palavrasBusca) {
        for (const palavraAssunto of palavrasAssunto) {
            // Verificar correspondência (case insensitive)
            if (palavraAssunto.toLowerCase().includes(palavraBusca) ||
                palavraBusca.includes(palavraAssunto.toLowerCase())) {
                pontos += 2;
            }
            
            // Verificar semelhança parcial
            if (palavraAssunto.toLowerCase().substring(0, 3) === palavraBusca.substring(0, 3)) {
                pontos += 1;
            }
        }
    }
    
    // Calcular porcentagem
    const maxPontos = palavrasBusca.length * palavrasAssunto.length * 2;
    const relevanciaPercent = Math.round((pontos / maxPontos) * 100);
    
    return relevanciaPercent;
}

// Mostrar resultados na página
function mostrarResultados(assuntos, palavrasBusca) {
    const resultadosElemento = document.getElementById('resultados');
    
    if (assuntos.length === 0) {
        resultadosElemento.innerHTML = `
            <div class="warning">
                <i class="fas fa-exclamation-triangle"></i>
                Nenhum assunto encontrado para: "${palavrasBusca.join(', ')}"
                <br>Cadastre novos assuntos com essas palavras-chave!
            </div>
        `;
        return;
    }

    let html = `<h3>${assuntos.length} assuntos encontrados:</h3>`;
    
    assuntos.forEach(assunto => {
        html += `
            <div class="assunto-item">
                <h3>${assunto.titulo}</h3>
                <p><strong>Categoria:</strong> ${assunto.categoria}</p>
                <p>${assunto.descricao || 'Sem descrição'}</p>
                <p class="palavras-chave">
                    <i class="fas fa-key"></i> Palavras-chave: ${assunto.palavras_chave.join(', ')}
                </p>
                <span class="relevancia">Relevância: ${assunto.relevancia}%</span>
                <button onclick="usarAssunto('${assunto.titulo}')" style="margin-top: 10px;">
                    <i class="fas fa-check"></i> Usar este assunto
                </button>
            <button onclick="editarAssunto('${assunto.id}')" style="margin-top: 10px; margin-left: 10px;">
                <i class="fas fa-edit"></i> Editar
            </button>
            </div>
        `;
    });
    
    resultadosElemento.innerHTML = html;
}

// Usar assunto selecionado
function usarAssunto(titulo) {
    alert(`Assunto selecionado: "${titulo}"\nVocê pode usar este assunto em seu ofício!`);
}

// Carregar todos assuntos cadastrados
async function carregarAssuntosCadastrados() {
    const listaElemento = document.getElementById('lista_assuntos');

    try {
        const snapshot = await assuntosRef.get();
        let html = '<ul>';
        
        snapshot.forEach(doc => {
            const assunto = doc.data();
            html += `
                <li>
                    <div>
                        <strong>${assunto.titulo}</strong><br>
                        <small>Categoria: ${assunto.categoria}</small><br>
                        <small>Palavras-chave: ${assunto.palavras_chave.join(', ')}</small>
                    </div>
                    <button class="delete" onclick="removerAssunto('${doc.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </li>
            `;
        });
        
        html += '</ul>';
        
        if (snapshot.size === 0) {
            html = '<div class="warning">Nenhum assunto cadastrado ainda!</div>';
        }

        listaElemento.innerHTML = html;
    } catch (error) {
        console.error('Erro ao carregar:', error);
        listaElemento.innerHTML = '<div class="warning">Erro ao carregar assuntos!</div>';
    }
}

// Remover assunto
async function removerAssunto(id) {
    if (!confirm('Tem certeza que deseja remover este assunto?')) return;

    try {
        await assuntosRef.doc(id).delete();
        alert('Assunto removido!');
        carregarAssuntosCadastrados();
    } catch (error) {
        console.error('Erro ao remover:', error);
        alert('Erro ao remover assunto!');
    }
}

// Editar assunto
async function editarAssunto(id) {
    try {
        const doc = await assuntosRef.doc(id).get();
        if (!doc.exists) return;

        const assunto = doc.data();
        
        document.getElementById('titulo').value = assunto.titulo;
        document.getElementById('palavras_chave').value = assunto.palavras_chave.join(', ');
        document.getElementById('categoria').value = assunto.categoria;
        document.getElementById('descricao').value = assunto.descricao || '';
        
        // Alterar função do botão para atualizar
        const btn = document.querySelector('.section button');
        btn.innerHTML = '<i class="fas fa-edit"></i> Atualizar Assunto';
        btn.onclick = async function() {
            await atualizarAssunto(id);
            btn.innerHTML = '<i class="fas fa-save"></i> Cadastrar Assunto';
            btn.onclick = cadastrarAssunto;
            limparFormulario();
        };
        
        alert('Preencha os campos e clique em "Atualizar Assunto"');
    } catch (error) {
        console.error('Erro ao editar:', error);
    }
}

// Atualizar assunto
async function atualizarAssunto(id) {
    const titulo = document.getElementById('titulo').value;
    const palavras_chave = document.getElementById('palavras_chave').value;
    const categoria = document.getElementById('categoria').value;
    const descricao = document.getElementById('descricao').value;

    const palavrasArray = palavras_chave.split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0);

    try {
        await assuntosRef.doc(id).update({
            titulo: titulo,
            palavras_chave: palavrasArray,
            categoria: categoria || "geral",
            descricao: descricao || "",
            data_atualizacao: new Date()
        });
        
        alert('Assunto atualizado!');
        carregarAssuntosCadastrados();
        buscarAssuntos();
    } catch (error) {
        console.error('Erro ao atualizar:', error);
        alert('Erro ao atualizar assunto!');
    }
}

// Função para cadastrar assuntos exemplo (teste)
async function cadastrarAssuntoTeste() {
    const assuntosTeste = [
        {
            titulo: "Solicitação de documentos pessoais",
            palavras_chave: ["documento", "certidão", "cópia", "RG", "CPF", "comprovante"],
            categoria: "administrativo",
            descricao: "Para solicitar documentos pessoais como RG, CPF, certidões"
        },
        {
            titulo: "Agendamento de reunião",
            palavras_chave: ["reunião", "agendar", "data", "horário", "audiência", "encontro"],
            categoria: "administrativo",
            descricao: "Para solicitar agendamento de reuniões ou audiências"
        },
        {
            titulo: "Solicitação de recursos financeiros",
            palavras_chave: ["dinheiro", "recursos", "financiamento", "investimento", "fundos", "pagamento"],
            categoria: "financeiro",
            descricao: "Para solicitar recursos financeiros ou financiamentos"
        },
        {
            titulo: "Autorização para viagem",
            palavras_chave: ["viagem", "deslocamento", "autorização", "passagem", "transporte", "missão"],
            categoria: "administrativo",
            descricao: "Para solicitar autorização para viagens ou deslocamentos"
        },
        {
            titulo: "Renovação de contrato",
            palavras_chave: ["contrato", "renovar", "prorrogação", "vigência", "término", "extensão"],
            categoria: "jurídico",
            descricao: "Para solicitar renovação ou prorrogação de contratos"
        }
    ];

    for (const assunto of assuntosTeste) {
        try {
            await assuntosRef.add(assunto);
            console.log(`Assunto "${assunto.titulo}" cadastrado!`);
        } catch (error) {
            console.error('Erro ao cadastrar teste:', error);
        }
    }

    alert('5 assuntos de exemplo cadastrados!');
    carregarAssuntosCadastrados();
}

// Função para listar todos assuntos no console
async function listarTodosAssuntos() {
    try {
        const snapshot = await assuntosRef.get();
        console.log("=== ASSUNTOS CADASTRADOS ===");
        snapshot.forEach(doc => {
            console.log(`ID: ${doc.id}`);
            console.log(doc.data());
            console.log("---");
        });
        console.log(`Total: ${snapshot.size} assuntos`);
    } catch (error) {
        console.error('Erro ao listar:', error);
    }
}

// Inicializar página
window.onload = function() {
    console.log("Sistema Gerador de Assuntos inicializado!");
    console.log("Comandos disponíveis no console:");
    console.log("- cadastrarAssuntoTeste()");
    console.log("- listarTodosAssuntos()");
    
    // Carregar assuntos cadastrados
    carregarAssuntosCadastrados();
};