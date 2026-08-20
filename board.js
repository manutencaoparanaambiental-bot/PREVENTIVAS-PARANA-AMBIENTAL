import { supabase, requireSession, wireLogout } from './supabaseClient.js';

/**
 * Abre o modal de cadastro de um novo veículo (truck ou conjunto).
 * Fica fora do initBoard porque não depende da página (lubrificação/calibragem):
 * o veículo cadastrado entra direto na tabela "caminhoes", compartilhada pelas duas.
 */
function abrirModalNovoVeiculo(){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h2>Novo veículo</h2>
      <input class="edit-input" id="novo-veiculo-placa" placeholder="Placa do caminhão" autofocus />
      <input class="edit-input" id="novo-veiculo-reboque" placeholder="Placa do implemento (vazio = truck simples)" />
      <div class="modal-error" id="novo-veiculo-erro"></div>
      <div class="edit-actions">
        <button class="btn-save" id="novo-veiculo-salvar">Salvar</button>
        <button class="btn-cancel" id="novo-veiculo-cancelar">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const inputPlaca = overlay.querySelector('#novo-veiculo-placa');
  const inputReboque = overlay.querySelector('#novo-veiculo-reboque');
  const erroEl = overlay.querySelector('#novo-veiculo-erro');
  inputPlaca.focus();

  function fechar(){ overlay.remove(); document.removeEventListener('keydown', onKeydown); }
  function onKeydown(e){ if(e.key === 'Escape') fechar(); }
  document.addEventListener('keydown', onKeydown);

  overlay.addEventListener('click', e => { if(e.target === overlay) fechar(); });
  overlay.querySelector('#novo-veiculo-cancelar').addEventListener('click', fechar);

  overlay.querySelector('#novo-veiculo-salvar').addEventListener('click', async () => {
    const placa = inputPlaca.value.trim().toUpperCase();
    const reboque = inputReboque.value.trim().toUpperCase();

    if(!placa){
      erroEl.textContent = 'Informe a placa.';
      return;
    }

    const tipo = reboque ? 'conjunto' : 'truck';
    const { error } = await supabase.from('caminhoes').insert({ placa, reboque: reboque || null, tipo });

    if(error){
      erroEl.textContent = error.code === '23505' ? 'Já existe um caminhão com essa placa.' : 'Não foi possível salvar.';
      return;
    }

    fechar();
    // O veículo novo entra sem posição — aparece em "Não escalado"/"Indisponível",
    // pronto para ser arrastado pra coluna certa. As telas abertas atualizam
    // sozinhas via realtime (subscrição na tabela "caminhoes").
  });
}

/**
 * Inicializa um quadro (lubrificação ou calibragem).
 * @param {string} pagina - 'lubrificacao' | 'calibragem'
 */
export async function initBoard(pagina){
  const session = await requireSession();
  if(!session) return;

  wireLogout(document.getElementById('btn-logout'));
  const userEl = document.getElementById('user-email');
  if(userEl) userEl.textContent = session.user.email;

  const btnNovoVeiculo = document.getElementById('btn-novo-veiculo');
  if(btnNovoVeiculo) btnNovoVeiculo.addEventListener('click', abrirModalNovoVeiculo);

  const boardEl = document.getElementById('board');
  let colunas = [];
  let caminhoes = [];
  let posicoesMap = {}; // caminhao_id -> { coluna_id, ordem }
  let editingId = null;  // placa sendo editada no momento (evita perder o card durante um refresh)
  let editError = '';
  let editingColunaId = null; // coluna (data/responsável) sendo editada no momento
  let colunaEditError = '';

  function formatarDataBR(iso){
    if(!iso) return null;
    const [ano, mes, dia] = iso.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  async function carregarDados(){
    if(editingId || editingColunaId) return; // não interrompe quem está editando
    const [{ data: cols, error: e1 }, { data: cams, error: e2 }, { data: pos, error: e3 }] = await Promise.all([
      supabase.from('colunas').select('*').eq('pagina', pagina).order('posicao'),
      supabase.from('caminhoes').select('*').order('placa'),
      supabase.from('posicoes').select('*').eq('pagina', pagina),
    ]);
    if(e1 || e2 || e3){
      console.error(e1 || e2 || e3);
      boardEl.innerHTML = `<p style="padding:20px;color:#FF5C5C">Erro ao carregar dados. Confira a configuração do Supabase em config.js.</p>`;
      return;
    }
    colunas = cols || [];
    caminhoes = cams || [];
    posicoesMap = {};
    (pos || []).forEach(p => { posicoesMap[p.caminhao_id] = p; });
    render();
  }

  function ordemColunas(){
    return [{ id: null, rotulo: 'Não escalado' }, ...colunas];
  }

  function cardHTML(caminhao){
    const tipoClasse = caminhao.tipo === 'conjunto' ? 'conjunto' : 'truck';
    const tipoLabel = caminhao.tipo === 'conjunto' ? 'Conjunto' : 'Truck';

    if(editingId === caminhao.id){
      return `
        <div class="card ${tipoClasse} editing" data-id="${caminhao.id}">
          <div class="card-top">
            <span class="tipo-badge">${tipoLabel}</span>
          </div>
          <input class="edit-input placa-input" data-field="placa" value="${caminhao.placa}" placeholder="Placa do caminhão" />
          <input class="edit-input reboque-input" data-field="reboque" value="${caminhao.reboque ?? ''}" placeholder="Placa do implemento (vazio = truck simples)" />
          ${editError ? `<div class="edit-error">${editError}</div>` : ''}
          <div class="edit-actions">
            <button class="btn-save" data-save="${caminhao.id}">Salvar</button>
            <button class="btn-cancel" data-cancel="${caminhao.id}">Cancelar</button>
          </div>
          <button class="btn-delete" data-delete="${caminhao.id}" data-delete-placa="${caminhao.placa}">Excluir veículo</button>
        </div>`;
    }

    const corpoHTML = caminhao.tipo === 'conjunto'
      ? `<div class="card-field"><span class="card-field-label">Caminhão</span><span class="plate placa">${caminhao.placa}</span></div>
         <div class="card-field"><span class="card-field-label">Implemento</span><span class="plate reboque">${caminhao.reboque ?? ''}</span></div>`
      : `<div class="card-field"><span class="card-field-label">Placa</span><span class="plate placa">${caminhao.placa}</span></div>`;

    return `
      <div class="card ${tipoClasse}" draggable="true" data-id="${caminhao.id}">
        <div class="card-top">
          <span class="tipo-badge">${tipoLabel}</span>
          <button class="edit-btn" data-edit="${caminhao.id}" title="Editar placa">✎</button>
        </div>
        ${corpoHTML}
      </div>`;
  }

  function colunaHeaderHTML(c, count){
    const isPool = c.id === null;

    if(isPool){
      return `
        <div class="col-head-top">
          <span>${c.rotulo}</span>
          <span class="count">${count}</span>
        </div>`;
    }

    if(pagina !== 'lubrificacao'){
      // Calibragem: mantém o comportamento original (rótulo livre editável)
      return `
        <div class="col-head-top">
          <input class="rotulo-edit" data-coluna-id="${c.id}" value="${c.rotulo}" />
          <span class="count">${count}</span>
        </div>`;
    }

    if(editingColunaId === c.id){
      return `
        <div class="col-edit-form">
          <input type="date" class="col-edit-input" data-col-field="data" value="${c.data_lubrificacao ?? ''}" />
          <input type="text" class="col-edit-input" data-col-field="responsavel" placeholder="Responsável" value="${c.responsavel ?? ''}" />
          ${colunaEditError ? `<div class="edit-error">${colunaEditError}</div>` : ''}
          <div class="col-edit-actions">
            <button class="btn-save" data-col-save="${c.id}">Salvar</button>
            <button class="btn-cancel" data-col-cancel="${c.id}">Cancelar</button>
          </div>
        </div>`;
    }

    const dataLabel = formatarDataBR(c.data_lubrificacao) || 'Definir data';
    return `
      <div class="col-head-top">
        <span class="col-date">${dataLabel}</span>
        <div class="col-head-actions">
          <button class="col-edit-btn" data-col-edit="${c.id}" title="Editar data e responsável">✎</button>
          <span class="count">${count}</span>
        </div>
      </div>
      <div class="col-resp">Responsável: ${c.responsavel || '—'}</div>`;
  }

  function render(){
    const seq = ordemColunas();
    const porColuna = {};
    seq.forEach(c => { porColuna[c.id ?? 'pool'] = []; });

    caminhoes.forEach(cam => {
      const p = posicoesMap[cam.id];
      const key = p ? p.coluna_id : 'pool';
      if(!porColuna[key]) porColuna[key] = [];
      porColuna[key].push({ cam, ordem: p ? p.ordem : 0 });
    });
    Object.values(porColuna).forEach(list => list.sort((a,b) => a.ordem - b.ordem));

    boardEl.innerHTML = seq.map(c => {
      const key = c.id ?? 'pool';
      const lista = porColuna[key] || [];
      const isPool = c.id === null;
      return `
        <div class="column ${isPool ? 'pool' : ''}" data-coluna-id="${key}">
          <div class="column-header">
            ${colunaHeaderHTML(c, lista.length)}
          </div>
          <div class="column-body" data-coluna-id="${key}">
            ${lista.map(x => cardHTML(x.cam)).join('')}
          </div>
        </div>`;
    }).join('');

    wireInteracoes();
  }

  async function moverCaminhao(caminhaoId, novaColunaId){
    if(novaColunaId === null || novaColunaId === '' || novaColunaId === undefined){
      await supabase.from('posicoes').delete()
        .eq('caminhao_id', caminhaoId).eq('pagina', pagina);
    } else {
      await supabase.from('posicoes')
        .upsert({
          caminhao_id: caminhaoId,
          pagina,
          coluna_id: novaColunaId,
          ordem: Date.now(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'caminhao_id,pagina' });
    }
    await carregarDados();
  }

  async function salvarEdicaoPlaca(caminhaoId, card){
    const placaRaw = card.querySelector('[data-field="placa"]').value.trim().toUpperCase();
    const reboqueRaw = card.querySelector('[data-field="reboque"]').value.trim().toUpperCase();

    if(!placaRaw){
      editError = 'Informe a placa.';
      render();
      return;
    }

    const tipo = reboqueRaw ? 'conjunto' : 'truck';
    const { error } = await supabase.from('caminhoes')
      .update({ placa: placaRaw, reboque: reboqueRaw || null, tipo })
      .eq('id', caminhaoId);

    if(error){
      editError = error.code === '23505' ? 'Já existe um caminhão com essa placa.' : 'Não foi possível salvar.';
      render();
      return;
    }

    editingId = null;
    editError = '';
    await carregarDados();
  }

  async function salvarEdicaoColuna(colunaId, form){
    const data = form.querySelector('[data-col-field="data"]').value; // 'YYYY-MM-DD' ou ''
    const responsavel = form.querySelector('[data-col-field="responsavel"]').value.trim();

    const { error } = await supabase.from('colunas')
      .update({ data_lubrificacao: data || null, responsavel: responsavel || null })
      .eq('id', colunaId);

    if(error){
      colunaEditError = 'Não foi possível salvar.';
      render();
      return;
    }

    editingColunaId = null;
    colunaEditError = '';
    await carregarDados();
  }

  async function excluirVeiculo(caminhaoId, placa){
    const ok = window.confirm(`Excluir o veículo ${placa}? Isso remove o cadastro e sua programação (lubrificação e calibragem). Não pode ser desfeito.`);
    if(!ok) return;

    const { error } = await supabase.from('caminhoes').delete().eq('id', caminhaoId);
    if(error){
      editError = 'Não foi possível excluir.';
      render();
      return;
    }

    editingId = null;
    editError = '';
    await carregarDados();
  }

  function wireInteracoes(){
    // Arrastar card para outra coluna
    boardEl.querySelectorAll('.card[draggable="true"]').forEach(card => {
      card.addEventListener('dragstart', e => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.dataset.id);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });

    boardEl.querySelectorAll('.column-body').forEach(colBody => {
      colBody.addEventListener('dragover', e => {
        e.preventDefault();
        colBody.closest('.column').classList.add('drag-over');
      });
      colBody.addEventListener('dragleave', () => {
        colBody.closest('.column').classList.remove('drag-over');
      });
      colBody.addEventListener('drop', e => {
        e.preventDefault();
        colBody.closest('.column').classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/plain');
        const destino = colBody.dataset.colunaId;
        moverCaminhao(id, destino === 'pool' ? null : destino);
      });
    });

    // Abrir edição da placa
    boardEl.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        editingId = btn.dataset.edit;
        editError = '';
        render();
      });
    });

    // Salvar / cancelar edição
    boardEl.querySelectorAll('[data-save]').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.card');
        salvarEdicaoPlaca(btn.dataset.save, card);
      });
    });
    boardEl.querySelectorAll('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', () => {
        editingId = null;
        editError = '';
        render();
      });
    });
    boardEl.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => {
        excluirVeiculo(btn.dataset.delete, btn.dataset.deletePlaca);
      });
    });

    // Edição do rótulo da coluna (calibragem — comportamento original)
    boardEl.querySelectorAll('.rotulo-edit').forEach(input => {
      input.addEventListener('change', async () => {
        await supabase.from('colunas')
          .update({ rotulo: input.value })
          .eq('id', input.dataset.colunaId);
      });
    });

    // Edição de data/responsável da coluna (lubrificação)
    boardEl.querySelectorAll('[data-col-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        editingColunaId = btn.dataset.colEdit;
        colunaEditError = '';
        render();
      });
    });
    boardEl.querySelectorAll('[data-col-save]').forEach(btn => {
      btn.addEventListener('click', () => {
        const form = btn.closest('.col-edit-form');
        salvarEdicaoColuna(btn.dataset.colSave, form);
      });
    });
    boardEl.querySelectorAll('[data-col-cancel]').forEach(btn => {
      btn.addEventListener('click', () => {
        editingColunaId = null;
        colunaEditError = '';
        render();
      });
    });
  }

  await carregarDados();

  // Tempo real: se outro usuário mover ou editar uma placa, a tela atualiza sozinha
  supabase
    .channel(`posicoes-${pagina}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'posicoes', filter: `pagina=eq.${pagina}` }, carregarDados)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'colunas', filter: `pagina=eq.${pagina}` }, carregarDados)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'caminhoes' }, carregarDados)
    .subscribe();
}
