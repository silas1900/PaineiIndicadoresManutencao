/* Gestão da Manutenção Corretiva — script.js
 * Parte 1: núcleo de dados e cálculos (sem DOM, testável em Node)
 * Parte 2: interface (filtros, KPIs, gráficos, tabelas, exportação)
 */
'use strict';

/* =====================================================================
 * PARTE 1 — NÚCLEO
 * ===================================================================== */
const Core = (function () {
  const SEM_SETOR = 'Setor não identificado';
  const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
  const DAY = 864e5, HOUR = 36e5;

  /* ---------- texto ---------- */
  const clean = v => (v == null ? '' : String(v)).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const norm = s => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normId = v => clean(v).toUpperCase();

  /* ---------- datas e horas (instantes "ingênuos" em UTC, sem fuso) ---------- */
  function validDay(y, m, d) {
    const t = Date.UTC(y, m - 1, d);
    const dt = new Date(t);
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? t : null;
  }
  /** Retorna {day (ms UTC, 00:00), sec (segundos do dia ou null)} ou null */
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) {
      if (isNaN(v)) return null;
      const day = Date.UTC(v.getFullYear(), v.getMonth(), v.getDate());
      const sec = v.getHours() * 3600 + v.getMinutes() * 60 + v.getSeconds();
      return { day, sec: sec > 0 ? sec : null };
    }
    if (typeof v === 'number') {
      if (!isFinite(v) || v < 1 || v > 80000) return null; // 80000 ≈ ano 2119
      const d = Math.floor(v);
      const sec = Math.round((v - d) * 86400);
      return { day: EXCEL_EPOCH + d * DAY, sec: sec > 0 && sec < 86400 ? sec : null };
    }
    const s = clean(v);
    let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    let y, mo, d, hh, mi, ss;
    if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; [hh, mi, ss] = [m[4], m[5], m[6]]; }
    else if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/))) { y = +m[1]; mo = +m[2]; d = +m[3]; [hh, mi, ss] = [m[4], m[5], m[6]]; }
    else return null;
    const day = validDay(y, mo, d);
    if (day == null) return null;
    const sec = hh != null ? (+hh) * 3600 + (+mi) * 60 + (+(ss || 0)) : null;
    return { day, sec: sec && sec < 86400 ? sec : null };
  }
  /** Retorna segundos desde 00:00 ou null */
  function parseTime(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v.getHours() * 3600 + v.getMinutes() * 60 + v.getSeconds();
    if (typeof v === 'number') {
      if (!isFinite(v) || v < 0) return null;
      const f = v >= 1 ? v - Math.floor(v) : v;
      if (v >= 1 && f === 0) return null;
      return Math.min(86399, Math.round(f * 86400));
    }
    const m = clean(v).match(/^(\d{1,2})[:h](\d{2})(?::(\d{2}))?$/i);
    if (!m) return null;
    const h = +m[1], mi = +m[2], s = +(m[3] || 0);
    if (h > 23 || mi > 59 || s > 59) return null;
    return h * 3600 + mi * 60 + s;
  }
  /** Combina data + hora → {ts, hasTime} ou null (se a data é inválida) */
  function combine(dateP, timeSec) {
    if (!dateP) return null;
    if (timeSec != null) return { ts: dateP.day + timeSec * 1000, hasTime: true };
    if (dateP.sec != null) return { ts: dateP.day + dateP.sec * 1000, hasTime: true };
    return { ts: dateP.day, hasTime: false };
  }

  /* ---------- cabeçalhos ---------- */
  const ALIASES = {
    ordem: ['ordem', 'os', 'n ordem', 'numero ordem', 'ordem de manutencao', 'ordem manutencao', 'no ordem'],
    idEquip: ['id equip', 'id equipamento', 'id', 'cod equip', 'codigo equipamento', 'codigo equip', 'tag', 'id do equipamento'],
    equipamento: ['equipamento', 'equipamentos', 'nome equipamento', 'nome do equipamento', 'descricao equipamento'],
    dataFalha: ['data falha', 'data da falha', 'dt falha'],
    horaFalha: ['hora falha', 'hora da falha', 'hr falha'],
    dataInicio: ['data inicio reparo', 'data inicio do reparo', 'data inicial reparo', 'data inicio', 'dt inicio reparo'],
    horaInicio: ['hora inicio reparo', 'hora inicio do reparo', 'hora inicial reparo', 'hora inicio', 'hr inicio reparo'],
    dataFim: ['data fim reparo', 'data fim do reparo', 'data final reparo', 'data termino reparo', 'data fim', 'dt fim reparo'],
    horaFim: ['hora fim reparo', 'hora fim do reparo', 'hora final reparo', 'hora termino reparo', 'hora fim', 'hr fim reparo'],
    qtd: ['qtd colab', 'qtd colaboradores', 'qtde colab', 'qtde colaboradores', 'quantidade colaboradores', 'quantidade de colaboradores', 'colaboradores', 'qtd colaborador'],
    tipo: ['tipo de falha', 'tipo falha', 'tipo', 'causa da falha'],
    setor: ['setor', 'area', 'departamento'],
  };
  const REQ_ORDENS = ['ordem', 'idEquip', 'dataFalha', 'horaFalha', 'dataInicio', 'horaInicio', 'dataFim', 'horaFim', 'qtd', 'tipo'];
  const REQ_EQUIP = ['idEquip', 'setor'];
  const LABEL = {
    ordem: 'ORdem', idEquip: 'ID Equip', equipamento: 'Equipamento', dataFalha: 'Data falha', horaFalha: 'Hora falha',
    dataInicio: 'Data inicio Reparo', horaInicio: 'Hora inicio reparo', dataFim: 'Data fim Reparo', horaFim: 'Hora fim Reparo',
    qtd: 'Qtd colab', tipo: 'Tipo de falha', setor: 'Setor',
  };

  /** Localiza a linha de cabeçalho (até a 10ª linha) e mapeia chave → índice de coluna */
  function mapHeaders(rows, keys) {
    const lookup = new Map();
    keys.forEach(k => ALIASES[k].forEach(a => lookup.set(a, k)));
    let best = { headerRow: 0, col: {}, found: -1 };
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const col = {}, dup = {};
      (rows[r] || []).forEach((cell, c) => {
        const k = lookup.get(norm(cell));
        if (!k) return;
        if (col[k] === undefined) col[k] = c; else (dup[k] = dup[k] || []).push(c);
      });
      // coluna duplicada de "Data ..." quando falta a "Hora ...": a segunda é, na verdade, a hora
      [['dataInicio', 'horaInicio'], ['dataFim', 'horaFim'], ['dataFalha', 'horaFalha']].forEach(([d, h]) => {
        if (dup[d] && col[h] === undefined && keys.includes(h)) col[h] = dup[d][0];
      });
      const found = Object.keys(col).length;
      if (found > best.found) best = { headerRow: r, col, found };
    }
    return best;
  }

  const num = v => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  };

  /* ---------- importação ---------- */
  /** sheets: { BaseOrdens: matriz, Equipamentos: matriz } (valores brutos) */
  function importData(sheetsRaw) {
    const report = { errors: [], warnings: [], invalid: [], duplicates: [], unmatchedIds: [], totalRows: 0 };
    const findSheet = name => {
      const k = Object.keys(sheetsRaw).find(n => norm(n).replace(/ /g, '') === name);
      return k ? sheetsRaw[k] : null;
    };
    const rowsO = findSheet('baseordens'), rowsE = findSheet('equipamentos');
    if (!rowsO) report.errors.push('Aba "BaseOrdens" não encontrada.');
    if (!rowsE) report.errors.push('Aba "Equipamentos" não encontrada.');
    if (report.errors.length) return { report };

    const hO = mapHeaders(rowsO, Object.keys(ALIASES).filter(k => k !== 'setor'));
    const hE = mapHeaders(rowsE, ['idEquip', 'equipamento', 'setor']);
    const missO = REQ_ORDENS.filter(k => hO.col[k] === undefined);
    const missE = REQ_EQUIP.filter(k => hE.col[k] === undefined);
    if (missO.length) report.errors.push('Colunas obrigatórias ausentes em BaseOrdens: ' + missO.map(k => LABEL[k]).join(', ') + '.');
    if (missE.length) report.errors.push('Colunas obrigatórias ausentes em Equipamentos: ' + missE.map(k => LABEL[k]).join(', ') + '.');
    if (report.errors.length) return { report };

    /* Equipamentos */
    const equips = new Map();
    for (let r = hE.headerRow + 1; r < rowsE.length; r++) {
      const row = rowsE[r] || [];
      const id = normId(row[hE.col.idEquip]);
      if (!id) continue;
      if (equips.has(id)) { report.warnings.push(`ID de equipamento duplicado na aba Equipamentos: ${id} (mantido o primeiro).`); continue; }
      equips.set(id, {
        id,
        nome: clean(hE.col.equipamento !== undefined ? row[hE.col.equipamento] : '') || id,
        setor: clean(row[hE.col.setor]) || SEM_SETOR,
      });
    }

    /* Ordens */
    const orders = [], seen = new Set(), unmatched = new Set();
    const c = hO.col;
    for (let r = hO.headerRow + 1; r < rowsO.length; r++) {
      const row = rowsO[r] || [];
      if (!row.some(x => x != null && clean(x) !== '')) continue; // linha vazia
      report.totalRows++;
      const ordem = clean(row[c.ordem]);
      const ref = ordem || `linha ${r + 1}`;
      if (ordem) {
        if (seen.has(ordem)) { report.duplicates.push(ordem); continue; }
        seen.add(ordem);
      }
      const dF = parseDate(row[c.dataFalha]);
      const falha = combine(dF, parseTime(row[c.horaFalha]));
      if (!falha) { report.invalid.push({ ordem: ref, motivo: 'Data da falha ausente ou inválida' }); continue; }

      const ini = combine(parseDate(row[c.dataInicio]), parseTime(row[c.horaInicio]));
      const fim = combine(parseDate(row[c.dataFim]), parseTime(row[c.horaFim]));
      const inicioTs = ini && ini.hasTime ? ini.ts : null;
      const fimTs = fim && fim.hasTime ? fim.ts : null;
      const qtdRaw = num(row[c.qtd]);
      const qtd = qtdRaw != null && qtdRaw > 0 ? qtdRaw : null;
      const id = normId(row[c.idEquip]);
      const eq = equips.get(id);
      if (!eq) unmatched.add(id || '(vazio)');

      const issues = [];
      if (!falha.hasTime) issues.push('Hora da falha ausente');
      if (inicioTs == null) issues.push('Início do reparo ausente/inválido');
      if (fimTs == null) issues.push('Término do reparo ausente/inválido');
      let durH = null, status;
      if (inicioTs != null && fimTs != null) {
        if (fimTs >= inicioTs) durH = (fimTs - inicioTs) / HOUR;
        else issues.push('Término anterior ao início');
      }
      if (qtd == null) issues.push('Qtd. de colaboradores ausente/inválida');
      const tipo = clean(row[c.tipo]);
      if (!tipo) issues.push('Tipo de falha ausente');
      if (!eq) issues.push('Equipamento sem cadastro');

      if (inicioTs != null && fimTs != null && fimTs < inicioTs) status = 'Inconsistente';
      else if (inicioTs == null) status = 'Dados incompletos';
      else if (fimTs == null) status = 'Pendente';
      else status = 'Concluído';

      const d = new Date(falha.ts);
      orders.push({
        ordem: ref, idEquip: id || '(vazio)',
        equipNome: eq ? eq.nome : (clean(c.equipamento !== undefined ? row[c.equipamento] : '') || id),
        setor: eq ? eq.setor : SEM_SETOR, matched: !!eq,
        tipo: tipo || 'Não informado', qtd,
        falhaTs: falha.ts, falhaTemHora: falha.hasTime, inicioTs, fimTs, durH,
        hh: durH != null && qtd != null ? durH * qtd : null,
        status, issues, complete: issues.length === 0 && status === 'Concluído',
        ano: d.getUTCFullYear(), mes: d.getUTCMonth(),
        ym: d.getUTCFullYear() * 12 + d.getUTCMonth(),
      });
    }
    report.unmatchedIds = [...unmatched];
    if (!orders.length) report.errors.push('Nenhuma ordem válida foi encontrada na aba BaseOrdens.');
    return { orders, equips, report };
  }

  /* ---------- cálculos ---------- */
  const sum = a => a.reduce((s, x) => s + x, 0);
  const mean = a => (a.length ? sum(a) / a.length : null);

  /** Intervalos entre falhas consecutivas do mesmo equipamento (horas). `base` = ordens já filtradas por setor/tipo/equip. */
  function computeIntervals(base) {
    const byEq = new Map();
    base.forEach(o => {
      if (!o.falhaTemHora) return;
      if (!byEq.has(o.idEquip)) byEq.set(o.idEquip, []);
      byEq.get(o.idEquip).push(o);
    });
    const out = [];
    byEq.forEach(list => {
      list.sort((a, b) => a.falhaTs - b.falhaTs);
      for (let i = 1; i < list.length; i++) {
        const h = (list[i].falhaTs - list[i - 1].falhaTs) / HOUR;
        if (h > 0) out.push({ idEquip: list[i].idEquip, h, ym: list[i].ym, ano: list[i].ano, mes: list[i].mes });
      }
    });
    return out;
  }

  const availability = (mtbf, mttr) => (mtbf != null && mttr != null && mtbf + mttr > 0 ? (mtbf / (mtbf + mttr)) * 100 : null);

  /** Agrupa ranking de equipamentos */
  function ranking(sel) {
    const g = new Map();
    sel.forEach(o => {
      if (!g.has(o.idEquip)) g.set(o.idEquip, { id: o.idEquip, nome: o.equipNome, setor: o.setor, falhas: 0, durs: [], hh: 0 });
      const e = g.get(o.idEquip);
      e.falhas++;
      if (o.durH != null) e.durs.push(o.durH);
      if (o.hh != null) e.hh += o.hh;
    });
    const list = [...g.values()].map(e => ({ ...e, mttr: mean(e.durs) }));
    list.sort((a, b) => b.falhas - a.falhas || (b.mttr ?? -1) - (a.mttr ?? -1) || a.id.localeCompare(b.id));
    return list;
  }

  /** Aplica filtros. Retorna ordens (sel), intervalos e base */
  function applyFilters(orders, f) {
    const base = orders.filter(o =>
      (!f.setor || o.setor === f.setor) && (!f.tipo || o.tipo === f.tipo) && (!f.equip || o.idEquip === f.equip));
    const inPeriod = o => (f.ano === '' || o.ano === +f.ano) && (f.mes === '' || o.mes === +f.mes);
    const sel = base.filter(inPeriod);
    const intervals = computeIntervals(base).filter(inPeriod);
    return { base, sel, intervals };
  }

  /** Todas as métricas a partir da seleção */
  function computeKpis(sel, intervals, equips, f, allOrders) {
    const durs = sel.filter(o => o.durH != null).map(o => o.durH);
    const hhList = sel.filter(o => o.hh != null);
    const mttr = mean(durs);
    const mtbf = mean(intervals.map(i => i.h));
    const rank = ranking(sel);
    const tipos = new Set(sel.map(o => o.tipo));
    // equipamentos cadastrados, respeitando setor e equipamento
    let registered;
    if (f.setor === SEM_SETOR) {
      registered = new Set(allOrders.filter(o => !o.matched && (!f.equip || o.idEquip === f.equip)).map(o => o.idEquip)).size;
    } else {
      registered = [...equips.values()].filter(e => (!f.setor || e.setor === f.setor) && (!f.equip || e.id === f.equip)).length;
    }
    const top = rank[0];
    return {
      total: sel.length, registered, withFailures: rank.length,
      hh: hhList.length ? sum(hhList.map(o => o.hh)) : null,
      hhMissing: sel.length - hhList.length,
      mttr, mtbf, nIntervals: intervals.length,
      avail: availability(mtbf, mttr),
      tipos: tipos.size,
      concluded: durs.length,
      pending: sel.filter(o => o.status === 'Pendente' || o.status === 'Dados incompletos').length,
      inconsistent: sel.filter(o => o.status === 'Inconsistente').length,
      completePct: sel.length ? (sel.filter(o => o.complete).length / sel.length) * 100 : null,
      top: top ? { nome: top.nome, id: top.id, falhas: top.falhas, ties: rank.filter(r => r.falhas === top.falhas).length - 1 } : null,
    };
  }

  /** Séries mensais para os gráficos. `axis` = lista de ym (ano*12+mês). */
  function monthlySeries(sel, intervals, axis) {
    const cnt = new Map(), dur = new Map(), ivs = new Map();
    sel.forEach(o => {
      cnt.set(o.ym, (cnt.get(o.ym) || 0) + 1);
      if (o.durH != null) (dur.get(o.ym) || dur.set(o.ym, []).get(o.ym)).push(o.durH);
    });
    intervals.forEach(i => (ivs.get(i.ym) || ivs.set(i.ym, []).get(i.ym)).push(i.h));
    const failures = axis.map(m => cnt.get(m) || 0);
    const mttr = axis.map(m => mean(dur.get(m) || []));
    const mtbf = axis.map(m => mean(ivs.get(m) || []));
    const nIv = axis.map(m => (ivs.get(m) || []).length);
    const nDur = axis.map(m => (dur.get(m) || []).length);
    const avail = axis.map((_, i) => availability(mtbf[i], mttr[i]));
    let acc = 0;
    const cumulative = failures.map(v => (acc += v));
    return { failures, mttr, mtbf, nIv, nDur, avail, cumulative };
  }

  function groupCount(sel, keyFn, valFn) {
    const g = new Map();
    sel.forEach(o => {
      const k = keyFn(o);
      g.set(k, (g.get(k) || 0) + (valFn ? valFn(o) || 0 : 1));
    });
    return [...g.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'pt-BR'));
  }

  return { SEM_SETOR, clean, norm, parseDate, parseTime, combine, mapHeaders, importData, computeIntervals, availability, ranking, applyFilters, computeKpis, monthlySeries, groupCount, mean, sum };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Core;

/* =====================================================================
 * PARTE 2 — INTERFACE
 * ===================================================================== */
if (typeof document !== 'undefined') (function () {
  const $ = (s, r = document) => r.querySelector(s);
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const MESES_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const ND = 'N/D';
  const fmt2 = v => (v == null ? ND : nf2.format(v));
  const pad = n => String(n).padStart(2, '0');
  const fmtDate = ts => { if (ts == null) return '—'; const d = new Date(ts); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
  const fmtDT = ts => { if (ts == null) return '—'; const d = new Date(ts); return `${fmtDate(ts)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  const fmtFalha = o => (o.falhaTemHora ? fmtDT(o.falhaTs) : fmtDate(o.falhaTs));
  const ymLabel = ym => `${MESES[ym % 12]}/${String(Math.floor(ym / 12)).slice(2)}`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- ícones (traçado estilo Lucide) ---------- */
  const ICONS = {
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
    hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    factory: '<path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    percent: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
    tag: '<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  };
  const icon = n => `<i data-icon="${n}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg></i>`;
  function hydrateIcons(root = document) {
    root.querySelectorAll('i[data-icon]:empty').forEach(el => {
      el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[el.dataset.icon] || ''}</svg>`;
    });
  }

  /* ---------- estado ---------- */
  const state = {
    orders: [], equips: new Map(), report: null, fileName: '', importedAt: null,
    filters: { ano: '', mes: '', setor: '', tipo: '', equip: '' },
    table: { search: '', key: 'falhaTs', dir: 'desc', page: 1, size: 15 },
    view: null, charts: {},
  };

  /* ---------- mensagens ---------- */
  function showMsg(text, type) {
    const el = $('#statusMsg');
    el.className = 'msg msg-' + type; el.textContent = text; el.hidden = false;
  }

  /* ---------- importação ---------- */
  function handleFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) { showMsg('Formato não suportado. Selecione um arquivo .xlsx ou .xls.', 'err'); return; }
    if (typeof XLSX === 'undefined') { showMsg('A biblioteca SheetJS não foi carregada (verifique a conexão com a internet ou coloque xlsx.full.min.js em lib/).', 'err'); return; }
    $('#loading').hidden = false;
    const reader = new FileReader();
    reader.onerror = () => { $('#loading').hidden = true; showMsg('Não foi possível ler o arquivo.', 'err'); };
    reader.onload = e => {
      setTimeout(() => { // permite o spinner aparecer
        try { processWorkbook(e.target.result, file.name); }
        catch (err) { console.error(err); showMsg('Erro ao processar a planilha: ' + err.message, 'err'); }
        finally { $('#loading').hidden = true; }
      }, 30);
    };
    reader.readAsArrayBuffer(file);
  }

  function processWorkbook(buffer, fileName) {
    const wb = XLSX.read(buffer, { type: 'array' }); // valores brutos: datas como número serial
    const sheets = {};
    wb.SheetNames.forEach(n => { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false }); });
    applyImport(Core.importData(sheets), fileName);
  }

  function applyImport(res, fileName, fixed) {
    if (res.report.errors.length) { showMsg('Importação não concluída. ' + res.report.errors.join(' '), 'err'); return; }
    state.orders = res.orders; state.equips = res.equips; state.report = res.report;
    state.fileName = fileName; state.importedAt = new Date();
    state.filters = { ano: '', mes: '', setor: '', tipo: '', equip: '' };
    state.table.page = 1; state.table.search = ''; $('#tblSearch').value = '';
    $('#emptyState').hidden = true; $('#dashboard').hidden = false;
    ['btnClear', 'btnCsv', 'btnPdf'].forEach(id => ($('#' + id).disabled = false));
    buildFilters();
    render();
    if (fixed) return; // versão fixa: sem painel de importação
    renderBaseInfo();
    const r = res.report;
    const parts = [`${nf0.format(res.orders.length)} ordens importadas`];
    if (r.invalid.length) parts.push(`${r.invalid.length} inválidas (sem data de falha válida)`);
    if (r.duplicates.length) parts.push(`${r.duplicates.length} duplicadas ignoradas`);
    if (r.unmatchedIds.length) parts.push(`${r.unmatchedIds.length} equipamento(s) sem correspondência`);
    showMsg(`Planilha importada com sucesso: ${parts.join(' · ')}.`, r.invalid.length || r.duplicates.length || r.unmatchedIds.length ? 'warn' : 'ok');
  }

  function renderBaseInfo() {
    const r = state.report, o = state.orders;
    const stat = (v, l, cls = '') => `<div class="base-stat ${cls}"><b>${nf0.format(v)}</b><span>${l}</span></div>`;
    const details = [];
    if (r.invalid.length) details.push(`<li>Registros inválidos: ${r.invalid.slice(0, 15).map(i => esc(i.ordem) + ' (' + esc(i.motivo) + ')').join('; ')}${r.invalid.length > 15 ? '…' : ''}</li>`);
    if (r.duplicates.length) details.push(`<li>Ordens duplicadas ignoradas: ${r.duplicates.slice(0, 15).map(esc).join(', ')}${r.duplicates.length > 15 ? '…' : ''}</li>`);
    if (r.unmatchedIds.length) details.push(`<li>IDs sem correspondência em Equipamentos (setor “${Core.SEM_SETOR}”): ${r.unmatchedIds.slice(0, 20).map(esc).join(', ')}</li>`);
    r.warnings.forEach(w => details.push(`<li>${esc(w)}</li>`));
    const box = $('#baseInfo');
    box.innerHTML =
      `<div class="base-file"><strong>${esc(state.fileName)}</strong> — importada em ${fmtDT(Date.UTC(state.importedAt.getFullYear(), state.importedAt.getMonth(), state.importedAt.getDate(), state.importedAt.getHours(), state.importedAt.getMinutes()))}</div>` +
      stat(o.length, 'ordens importadas', 'ok') +
      stat(r.invalid.length, 'registros inválidos', r.invalid.length ? 'warn' : '') +
      stat(r.duplicates.length, 'ordens duplicadas', r.duplicates.length ? 'warn' : '') +
      stat(state.equips.size, 'equipamentos cadastrados') +
      stat(r.unmatchedIds.length, 'IDs sem correspondência', r.unmatchedIds.length ? 'warn' : '') +
      stat(o.filter(x => !x.complete).length, 'ordens com dados incompletos') +
      (details.length ? `<details class="base-details"><summary>Ver detalhes da importação</summary><ul>${details.join('')}</ul></details>` : '');
    box.hidden = false;
  }

  /* ---------- filtros ---------- */
  const fEl = { ano: $('#fAno'), mes: $('#fMes'), setor: $('#fSetor'), tipo: $('#fTipo'), equip: $('#fEquip') };
  const opt = (v, t, sel) => `<option value="${esc(v)}"${String(sel) === String(v) ? ' selected' : ''}>${esc(t)}</option>`;

  function buildFilters() {
    const f = state.filters, o = state.orders;
    const anos = [...new Set(o.map(x => x.ano))].sort((a, b) => a - b);
    fEl.ano.innerHTML = opt('', 'Todos', f.ano) + anos.map(a => opt(a, a, f.ano)).join('');
    fEl.mes.innerHTML = opt('', 'Todos', f.mes) + MESES_FULL.map((m, i) => opt(i, m, f.mes)).join('');
    const setores = new Set([...state.equips.values()].map(e => e.setor));
    o.forEach(x => setores.add(x.setor));
    fEl.setor.innerHTML = opt('', 'Todos', f.setor) + [...setores].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(s => opt(s, s, f.setor)).join('');
    const tipos = [...new Set(o.map(x => x.tipo))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    fEl.tipo.innerHTML = opt('', 'Todos', f.tipo) + tipos.map(t => opt(t, t, f.tipo)).join('');
    buildEquipOptions();
  }
  function buildEquipOptions() {
    const f = state.filters;
    const list = new Map();
    state.equips.forEach(e => { if (!f.setor || e.setor === f.setor) list.set(e.id, e.nome); });
    state.orders.forEach(x => { if (!x.matched && (!f.setor || f.setor === Core.SEM_SETOR)) list.set(x.idEquip, x.equipNome); });
    if (f.equip && !list.has(f.equip)) f.equip = '';
    const items = [...list.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    fEl.equip.innerHTML = opt('', 'Todos', f.equip) + items.map(([id, n]) => opt(id, `${id} — ${n}`, f.equip)).join('');
  }
  Object.keys(fEl).forEach(k => fEl[k].addEventListener('change', () => {
    state.filters[k] = fEl[k].value;
    if (k === 'setor') buildEquipOptions();
    state.table.page = 1;
    render();
  }));
  function clearFilters() {
    state.filters = { ano: '', mes: '', setor: '', tipo: '', equip: '' };
    state.table.page = 1; state.table.search = ''; $('#tblSearch').value = '';
    buildFilters(); render();
  }

  /* ---------- renderização geral ---------- */
  function render() {
    if (!state.orders.length) return;
    const f = state.filters;
    const { sel, intervals } = Core.applyFilters(state.orders, f);
    const k = Core.computeKpis(sel, intervals, state.equips, f, state.orders);

    // eixo mensal: toda a faixa da base, recortada pelos filtros de ano/mês
    const yms = state.orders.map(o => o.ym);
    const min = Math.min(...yms), max = Math.max(...yms);
    const axis = [];
    for (let m = min; m <= max; m++) {
      if (f.ano !== '' && Math.floor(m / 12) !== +f.ano) continue;
      if (f.mes !== '' && m % 12 !== +f.mes) continue;
      axis.push(m);
    }
    const series = Core.monthlySeries(sel, intervals, axis);
    state.view = { sel, k, axis, series };

    $('#noData').hidden = sel.length > 0;
    renderHeaderInfo(sel);
    renderKpis(k);
    renderCharts(sel, axis, series);
    renderRanking(sel);
    renderTable();
  }

  function renderHeaderInfo(sel) {
    const parts = [];
    if (sel.length) {
      const ts = sel.map(o => o.falhaTs);
      parts.push(`Período analisado: ${fmtDate(Math.min(...ts))} a ${fmtDate(Math.max(...ts))}`);
    } else parts.push('Período analisado: sem ordens para os filtros');
    if (window.DADOS_EMBUTIDOS) parts.push(`Base: ${state.fileName}`);
    else parts.push(`Última importação: ${state.importedAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`);
    const f = state.filters, act = [];
    if (f.ano !== '') act.push('Ano ' + f.ano);
    if (f.mes !== '') act.push(MESES_FULL[+f.mes]);
    if (f.setor) act.push(f.setor);
    if (f.tipo) act.push(f.tipo);
    if (f.equip) act.push(f.equip);
    if (act.length) parts.push('Filtros: ' + act.join(', '));
    $('#subInfo').textContent = parts.join('  ·  ');
  }

  function renderKpis(k) {
    const card = (ico, label, value, desc, tone = '', unit = '') => {
      const nd = value === ND;
      return `<div class="kpi ${tone}"><span class="ico">${icon(ico)}</span><div><div class="lbl">${label}</div><div class="val${nd ? ' nd' : ''}">${esc(value)}${unit && !nd ? `<small>${unit}</small>` : ''}</div><div class="desc">${desc}</div></div></div>`;
    };
    $('#kpis').innerHTML = [
      card('alert', 'Total de falhas', nf0.format(k.total), 'Ordens corretivas distintas', 't-red'),
      card('factory', 'Equipamentos cadastrados', nf0.format(k.registered), 'Aba Equipamentos (filtros de setor/equip.)', 't-navy'),
      card('cog', 'Equipamentos com falhas', nf0.format(k.withFailures), `de ${nf0.format(k.registered)} cadastrados no recorte`, 't-amber'),
      card('users', 'Homem-hora (HH)', k.hh == null ? ND : nf1.format(k.hh), `${nf0.format(k.hhMissing)} ordem(ns) sem dados p/ HH`, '', ' h'),
      card('clock', 'MTTR', fmt2(k.mttr), `Tempo médio de reparo · ${nf0.format(k.concluded)} reparos válidos`, '', ' h'),
      card('activity', 'MTBF', fmt2(k.mtbf), `Entre falhas consecutivas · ${nf0.format(k.nIntervals)} intervalo(s)`, '', ' h'),
      card('gauge', 'Disponibilidade estimada', k.avail == null ? ND : nf1.format(k.avail), 'MTBF ÷ (MTBF + MTTR) — estimativa', 't-green', ' %'),
      card('tag', 'Tipos de falha', nf0.format(k.tipos), 'Tipos distintos identificados'),
      card('check', 'Reparos concluídos', nf0.format(k.concluded), 'Início e término válidos', 't-green'),
      card('hourglass', 'Pendentes / sem conclusão', nf0.format(k.pending), `Sem término ou início${k.inconsistent ? ` · ${k.inconsistent} inconsistente(s)` : ''}`, k.pending ? 't-amber' : ''),
      card('percent', 'Ordens com dados completos', k.completePct == null ? ND : nf1.format(k.completePct), 'Todos os campos válidos e coerentes', '', ' %'),
      card('trophy', 'Equipamento mais crítico', k.top ? k.top.nome : ND, k.top ? `${k.top.id} · ${k.top.falhas} falhas${k.top.ties ? ` (+${k.top.ties} empatado${k.top.ties > 1 ? 's' : ''})` : ''}` : 'Sem falhas no recorte', 't-red'),
    ].join('');
    // nome do equipamento é texto longo: reduz a fonte
    const last = $('#kpis').lastElementChild.querySelector('.val');
    if (last) last.style.fontSize = '17px';
  }

  /* ---------- gráficos ---------- */
  const C = { navy: '#0b2a4a', blue: '#1f5fa8', sky: '#5aa0dc', amber: '#e8a33d', red: '#d64545', green: '#2e9e6b', teal: '#2a9d8f', purple: '#7a5bb0', grid: '#e6ebf1', ink: '#48576b' };
  const PALETTE = [C.blue, C.amber, C.teal, C.purple, C.red, C.sky, C.green, C.navy];

  const valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw(chart, _a, opts) {
      if (!opts || !opts.enabled) return;
      const ctx = chart.ctx, horiz = chart.options.indexAxis === 'y', ds = chart.data.datasets[0];
      ctx.save();
      ctx.font = '600 11px ' + (Chart.defaults.font.family || 'sans-serif');
      ctx.fillStyle = '#2b3b52';
      chart.getDatasetMeta(0).data.forEach((el, i) => {
        const v = ds.data[i];
        if (v == null) return;
        const txt = opts.fmt ? opts.fmt(v) : String(v);
        if (horiz) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, el.x + 6, el.y); }
        else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(txt, el.x, el.y - 4); }
      });
      ctx.restore();
    },
  };

  function upsertChart(id, cfg) {
    if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === 'undefined') return;
    cfg.plugins = (cfg.plugins || []).concat(valueLabels);
    cfg.options = cfg.options || {};
    cfg.options.animation = Object.assign({}, cfg.options.animation, { onComplete: () => syncPrintImg(id) });
    state.charts[id] = new Chart(canvas.getContext('2d'), cfg);
  }
  function destroyCharts() { Object.keys(state.charts).forEach(k => { state.charts[k].destroy(); delete state.charts[k]; }); }

  const scaleBase = (title) => ({
    grid: { color: C.grid }, ticks: { color: C.ink, font: { size: 11 } },
    border: { display: false }, title: title ? { display: true, text: title, color: C.ink, font: { size: 11 } } : { display: false },
  });
  const common = (extra = {}) => ({
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0b2a4a', padding: 10, cornerRadius: 8 } },
    ...extra,
  });

  function renderCharts(sel, axis, s) {
    if (typeof Chart === 'undefined') { showMsg('A biblioteca Chart.js não foi carregada (verifique a internet ou coloque chart.umd.js em lib/).', 'err'); return; }
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    const labels = axis.map(ymLabel);
    const intFmt = v => nf0.format(v);

    // 1. Falhas por mês
    upsertChart('ch1', {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Falhas', data: s.failures, backgroundColor: C.blue, borderRadius: 4, maxBarThickness: 46 }] },
      options: common({
        scales: { x: { ...scaleBase(), grid: { display: false } }, y: { ...scaleBase('Quantidade de falhas'), beginAtZero: true, grace: '12%', ticks: { precision: 0, color: C.ink } } },
        plugins: { legend: { display: false }, valueLabels: { enabled: true, fmt: intFmt }, tooltip: { backgroundColor: '#0b2a4a', callbacks: { label: c => ` ${c.parsed.y} falha(s)` } } },
      }),
    });

    // 2. Tipos de falha (rosca)
    const tipos = Core.groupCount(sel, o => o.tipo);
    const totalT = Core.sum(tipos.map(t => t[1]));
    upsertChart('ch2', {
      type: 'doughnut',
      data: { labels: tipos.map(t => `${t[0]} — ${t[1]} (${nf1.format((t[1] / totalT) * 100)}%)`), datasets: [{ data: tipos.map(t => t[1]), backgroundColor: tipos.map((_, i) => PALETTE[i % PALETTE.length]), borderWidth: 2, borderColor: '#fff' }] },
      options: common({
        cutout: '58%',
        plugins: {
          legend: { display: true, position: 'right', labels: { color: C.ink, boxWidth: 12, font: { size: 12 } } },
          tooltip: { backgroundColor: '#0b2a4a', callbacks: { label: c => ` ${c.parsed} ocorrência(s) · ${nf1.format((c.parsed / totalT) * 100)}%` } },
        },
      }),
    });

    // 3. Falhas por setor
    const setores = Core.groupCount(sel, o => o.setor);
    upsertChart('ch3', {
      type: 'bar',
      data: { labels: setores.map(x => x[0]), datasets: [{ label: 'Falhas', data: setores.map(x => x[1]), backgroundColor: C.navy, borderRadius: 4, maxBarThickness: 30 }] },
      options: common({
        indexAxis: 'y',
        scales: { x: { ...scaleBase('Falhas'), beginAtZero: true, grace: '14%', ticks: { precision: 0, color: C.ink } }, y: { ...scaleBase(), grid: { display: false } } },
        plugins: { legend: { display: false }, valueLabels: { enabled: true, fmt: intFmt }, tooltip: { backgroundColor: '#0b2a4a' } },
      }),
    });

    // 4. MTBF mensal
    upsertChart('ch4', areaCfg(labels, s.mtbf, C.teal, 'MTBF', ' h', s.nIv, 'intervalo(s)'));
    // 5. MTTR mensal
    upsertChart('ch5', areaCfg(labels, s.mttr, C.amber, 'MTTR', ' h', s.nDur, 'reparo(s)'));
    // 6. Disponibilidade
    const cfg6 = areaCfg(labels, s.avail, C.green, 'Disponibilidade estimada', ' %', null, '');
    cfg6.options.scales.y.min = 0; cfg6.options.scales.y.max = 100;
    cfg6.options.scales.y.ticks.callback = v => v + '%';
    upsertChart('ch6', cfg6);

    // 7. HH por setor
    const hh = Core.groupCount(sel, o => o.setor, o => o.hh);
    upsertChart('ch7', {
      type: 'bar',
      data: { labels: hh.map(x => x[0]), datasets: [{ label: 'HH', data: hh.map(x => Math.round(x[1] * 100) / 100), backgroundColor: C.sky, borderRadius: 4, maxBarThickness: 46 }] },
      options: common({
        scales: { x: { ...scaleBase(), grid: { display: false } }, y: { ...scaleBase('Homem-hora (h)'), beginAtZero: true, grace: '12%' } },
        plugins: { legend: { display: false }, valueLabels: { enabled: true, fmt: v => nf1.format(v) }, tooltip: { backgroundColor: '#0b2a4a', callbacks: { label: c => ` ${nf2.format(c.parsed.y)} HH` } } },
      }),
    });

    // 8. Acumulado
    upsertChart('ch8', {
      type: 'line',
      data: { labels, datasets: [{ label: 'Falhas acumuladas', data: s.cumulative, borderColor: C.red, backgroundColor: 'rgba(214,69,69,.10)', fill: true, tension: 0.25, pointRadius: 4, pointBackgroundColor: C.red }] },
      options: common({
        scales: { x: { ...scaleBase(), grid: { display: false } }, y: { ...scaleBase('Falhas acumuladas'), beginAtZero: true, grace: '8%', ticks: { precision: 0, color: C.ink } } },
        plugins: { legend: { display: false }, tooltip: { backgroundColor: '#0b2a4a', callbacks: { label: c => ` ${c.parsed.y} falhas acumuladas` } } },
      }),
    });
  }

  function areaCfg(labels, data, color, name, unit, counts, countLabel) {
    return {
      type: 'line',
      data: { labels, datasets: [{ label: name, data, borderColor: color, backgroundColor: color + '33', fill: true, tension: 0.3, spanGaps: false, pointRadius: 4, pointBackgroundColor: color }] },
      options: common({
        scales: { x: { ...scaleBase(), grid: { display: false } }, y: { ...scaleBase(unit.trim() === 'h' ? 'Horas' : ''), beginAtZero: true, grace: '10%' } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0b2a4a',
            callbacks: {
              label: c => ` ${name}: ${c.parsed.y == null ? ND : nf2.format(c.parsed.y) + unit}`,
              afterLabel: c => (counts ? `Base: ${counts[c.dataIndex]} ${countLabel}` : ''),
            },
          },
        },
      }),
    };
  }

  /* ---------- ranking ---------- */
  function renderRanking(sel) {
    const rk = Core.ranking(sel).slice(0, 10);
    const tb = $('#rankingTable tbody');
    if (!rk.length) { tb.innerHTML = '<tr><td class="empty" colspan="7">Sem dados para os filtros selecionados.</td></tr>'; return; }
    const maxF = rk[0].falhas;
    tb.innerHTML = rk.map((e, i) => {
      const w = Math.max(4, Math.round((e.falhas / maxF) * 90));
      return `<tr><td><span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span></td><td>${esc(e.id)}</td><td>${esc(e.nome)}</td><td>${esc(e.setor)}</td>` +
        `<td class="num"><div class="barcell"><span class="bar ${i < 3 ? 'hot' : ''}" style="width:${w}px"></span><strong>${e.falhas}</strong></div></td>` +
        `<td class="num">${fmt2(e.mttr)}</td><td class="num">${nf2.format(e.hh)}</td></tr>`;
    }).join('');
  }

  /* ---------- tabela detalhada ---------- */
  const COLS = ['ordem', 'idEquip', 'equipNome', 'setor', 'falhaTs', 'tipo', 'inicioTs', 'fimTs', 'durH', 'qtd', 'hh', 'status'];
  const searchText = o => [o.ordem, o.idEquip, o.equipNome, o.setor, fmtFalha(o), o.tipo, fmtDT(o.inicioTs), fmtDT(o.fimTs), o.durH == null ? '' : nf2.format(o.durH), o.qtd ?? '', o.hh == null ? '' : nf2.format(o.hh), o.status, o.issues.join(' ')].join(' ').toLowerCase();

  function tableRows() {
    const t = state.table, q = t.search.trim().toLowerCase();
    let rows = state.view.sel;
    if (q) rows = rows.filter(o => (o._s || (o._s = searchText(o))).includes(q));
    const dir = t.dir === 'asc' ? 1 : -1, key = t.key;
    return rows.slice().sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;           // vazios sempre ao final
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * dir;
    });
  }

  function renderTable() {
    const t = state.table, rows = tableRows();
    const pages = Math.max(1, Math.ceil(rows.length / t.size));
    if (t.page > pages) t.page = pages;
    const slice = rows.slice((t.page - 1) * t.size, t.page * t.size);
    const tb = $('#ordersTable tbody');
    if (!rows.length) tb.innerHTML = '<tr><td class="empty" colspan="12">Nenhuma ordem encontrada para os filtros/pesquisa.</td></tr>';
    else tb.innerHTML = slice.map(o => {
      const cls = o.status === 'Inconsistente' ? 'row-err' : (o.issues.length ? 'row-warn' : '');
      const bcls = o.status === 'Concluído' && !o.issues.length ? 'b-ok' : o.status === 'Inconsistente' ? 'b-err' : 'b-warn';
      const tip = o.issues.length ? ` title="${esc(o.issues.join('; '))}"` : '';
      return `<tr class="${cls}"><td>${esc(o.ordem)}</td><td>${esc(o.idEquip)}</td><td>${esc(o.equipNome)}</td><td>${esc(o.setor)}</td><td>${fmtFalha(o)}</td><td>${esc(o.tipo)}</td>` +
        `<td>${fmtDT(o.inicioTs)}</td><td>${fmtDT(o.fimTs)}</td><td class="num">${o.durH == null ? ND : nf2.format(o.durH)}</td><td class="num">${o.qtd ?? ND}</td><td class="num">${o.hh == null ? ND : nf2.format(o.hh)}</td>` +
        `<td><span class="badge ${bcls}"${tip}>${esc(o.status)}</span></td></tr>`;
    }).join('');
    document.querySelectorAll('#ordersTable th[data-key]').forEach(th => {
      th.classList.remove('asc', 'desc');
      if (th.dataset.key === t.key) th.classList.add(t.dir);
      th.setAttribute('aria-sort', th.dataset.key === t.key ? (t.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });
    const from = rows.length ? (t.page - 1) * t.size + 1 : 0, to = Math.min(rows.length, t.page * t.size);
    $('#pageInfo').textContent = `${nf0.format(from)}–${nf0.format(to)} de ${nf0.format(rows.length)} ordens · página ${t.page} de ${pages}`;
    $('#prevPage').disabled = t.page <= 1; $('#nextPage').disabled = t.page >= pages;
  }

  /* ---------- exportação ---------- */
  function exportCsv() {
    if (!state.view) return;
    const rows = tableRows();
    const head = ['Ordem', 'ID Equip', 'Equipamento', 'Setor', 'Data/hora falha', 'Tipo de falha', 'Início reparo', 'Término reparo', 'Duração (h)', 'Qtd colab', 'HH', 'Situação', 'Observações'];
    const q = v => { const s = String(v ?? ''); return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const n = v => (v == null ? '' : nf2.format(v).replace(/\./g, ''));
    const lines = [head.join(';')].concat(rows.map(o => [o.ordem, o.idEquip, o.equipNome, o.setor, fmtFalha(o), o.tipo, o.inicioTs == null ? '' : fmtDT(o.inicioTs), o.fimTs == null ? '' : fmtDT(o.fimTs), n(o.durH), o.qtd ?? '', n(o.hh), o.status, o.issues.join(' | ')].map(q).join(';')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ordens_manutencao_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- eventos ---------- */
  const fileInput = $('#fileInput');
  $('#btnImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { handleFile(fileInput.files[0]); fileInput.value = ''; });
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
  $('#btnClear').addEventListener('click', clearFilters);
  $('#btnCsv').addEventListener('click', exportCsv);
  // Impressão/PDF: cada gráfico tem uma imagem espelho (gerada após o desenho), já carregada
  // antes de imprimir, para evitar quadros em branco por carregamento assíncrono.
  function syncPrintImg(id) {
    const cv = document.getElementById(id);
    if (!cv || !cv.width || !cv.height) return;
    const box = cv.parentElement;
    let img = box.querySelector('.print-img');
    if (!img) { img = new Image(); img.className = 'print-img'; img.alt = ''; box.appendChild(img); }
    try { img.src = cv.toDataURL('image/png'); img.style.aspectRatio = cv.width + ' / ' + cv.height; }
    catch (e) { console.warn('Gráfico não convertido para impressão', e); }
  }
  window.addEventListener('beforeprint', () => Object.keys(state.charts).forEach(syncPrintImg));
  $('#btnPdf').addEventListener('click', () => window.print()); // escolha "Salvar como PDF" no diálogo
  $('#tblSearch').addEventListener('input', e => { state.table.search = e.target.value; state.table.page = 1; if (state.view) renderTable(); });
  $('#ordersTable thead').addEventListener('click', e => {
    const th = e.target.closest('th[data-key]');
    if (!th) return;
    const t = state.table;
    if (t.key === th.dataset.key) t.dir = t.dir === 'asc' ? 'desc' : 'asc'; else { t.key = th.dataset.key; t.dir = 'asc'; }
    t.page = 1; renderTable();
  });
  $('#prevPage').addEventListener('click', () => { state.table.page--; renderTable(); });
  $('#nextPage').addEventListener('click', () => { state.table.page++; renderTable(); });

  hydrateIcons();
  if (window.DADOS_EMBUTIDOS) { // versão fixa (portfólio): dados já embutidos, sem upload
    document.body.classList.add('fixed');
    try { applyImport(Core.importData(window.DADOS_EMBUTIDOS.sheets), window.DADOS_EMBUTIDOS.nome, true); }
    catch (err) { console.error(err); showMsg('Erro ao carregar os dados embutidos: ' + err.message, 'err'); }
  }
  window.__dash = { state, render, destroyCharts }; // útil para depuração no console
})();
