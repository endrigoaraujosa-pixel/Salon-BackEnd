
import { getClienteModel } from '../models/Cliente.js';
import { getColaboradorModel } from '../models/Colaborador.js';
import { getProdutoModel } from '../models/Produto.js';
import { getServicoModel } from '../models/Servico.js';
import { getAgendamentoModel } from '../models/Agendamento.js';
import { getUserModel } from '../models/User.js';
import { getDescontoModel } from '../models/Desconto.js';
import { getVendaDiretaModel } from '../models/VendaDireta.js';
import { getDespesaModel } from '../models/Despesa.js';
import { getOutrasReceitasModel } from '../models/OutrasReceitas.js';
import { getCategoriaModel } from '../models/Categoria.js';
import { getFornecedorModel } from '../models/Fornecedor.js';
import { getAdquirenteModel } from '../models/Adquirente.js';
import { getTaxaCartaoModel } from '../models/TaxaCartao.js';
import { sequelize } from '../config/db.js';

const getDeletados = async (req, res) => {
  const { modulo } = req.query;

  try {
    let rawRecords = [];

    switch (modulo) {
      case 'cliente':
        rawRecords = await getClienteModel().findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'colaborador':
        rawRecords = await getColaboradorModel().findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'servico':
        rawRecords = await getServicoModel().findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'produto':
        rawRecords = await getProdutoModel().findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'usuario':
        rawRecords = await getUserModel().findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'agendamento':
        rawRecords = await getAgendamentoModel().findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'venda_direta':
      case 'venda':
        rawRecords = await getVendaDiretaModel().findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'despesa':
        rawRecords = await getDespesaModel().findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'receita':
        rawRecords = await getOutrasReceitasModel().findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'categoria':
        rawRecords = await getCategoriaModel().findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'fornecedor':
        rawRecords = await getFornecedorModel().findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'desconto':
        rawRecords = await getDescontoModel().findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      case 'adquirente':
        rawRecords = await getAdquirenteModel().findAll({ where: { deletado: 'S' }, order: [['deletado_em', 'DESC']] });
        break;
      default:
        return res.status(400).json({ detail: 'Módulo inválido para consulta de auditoria.' });
    }

    // Format all records into a standardized structure
    const formatted = rawRecords.map(r => {
      let descricao = '';
      
      if (modulo === 'cliente' || modulo === 'colaborador' || modulo === 'servico' || modulo === 'produto' || modulo === 'categoria') {
        descricao = r.nome;
      } else if (modulo === 'adquirente') {
        descricao = r.descricao;
      } else if (modulo === 'desconto') {
        descricao = `${r.codigo}${r.descricao ? ` - ${r.descricao}` : ''}`;
      } else if (modulo === 'fornecedor') {
        descricao = r.nome_razosocial;
      } else if (modulo === 'usuario') {
        descricao = r.name || r.email;
      } else if (modulo === 'despesa' || modulo === 'receita') {
        descricao = `${r.descricao} (Valor: R$ ${Number(r.valor).toFixed(2)})`;
      } else if (modulo === 'agendamento') {
        // Agendamento description formatting
        const numServico = r.numero ? `${String(r.numero).padStart(6, '0')} | S` : 'N/A';
        const dataHora = r.data_hora ? new Date(r.data_hora).toLocaleString('pt-BR') : 'N/A';
        descricao = `${numServico} - Cliente: ${r.cliente_nome || 'N/A'} - Data: ${dataHora} - Total: R$ ${Number(r.valor_total).toFixed(2)}`;
      } else if (modulo === 'venda' || modulo === 'venda_direta') {
        // Venda description formatting
        const numVenda = r.numero_venda ? `${String(r.numero_venda).padStart(6, '0')} | V` : 'N/A';
        const dataVenda = r.data_venda ? new Date(r.data_venda).toLocaleString('pt-BR') : 'N/A';
        descricao = `${numVenda} - Cliente: ${r.cliente_nome || 'Consumidor'} - Data: ${dataVenda} - Total: R$ ${Number(r.valor_total).toFixed(2)}`;
      }

      return {
        id: r.id,
        descricao,
        deletado_por: r.deletado_por || 'Sistema',
        deletado_em: r.deletado_em
      };
    });

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const restoreRecord = async (req, res) => {
  const { modulo, id } = req.body;

  try {
    let model;
    switch (modulo) {
      case 'cliente':
        model = getClienteModel();
        break;
      case 'colaborador':
        model = getColaboradorModel();
        break;
      case 'servico':
        model = getServicoModel();
        break;
      case 'produto':
        model = getProdutoModel();
        break;
      case 'usuario':
        model = getUserModel();
        break;
      case 'agendamento':
        model = getAgendamentoModel();
        break;
      case 'venda_direta':
      case 'venda':
        model = getVendaDiretaModel();
        break;
      case 'despesa':
        model = getDespesaModel();
        break;
      case 'receita':
        model = getOutrasReceitasModel();
        break;
      case 'categoria':
        model = getCategoriaModel();
        break;
      case 'fornecedor':
        model = getFornecedorModel();
        break;
      case 'desconto':
        model = getDescontoModel();
        break;
      case 'adquirente':
        model = getAdquirenteModel();
        break;
      default:
        return res.status(400).json({ detail: 'Módulo inválido para restauração.' });
    }

    const record = await model.findByPk(id);
    if (!record) {
      return res.status(404).json({ detail: 'Registro não encontrado.' });
    }

    if (record.deletado !== 'S') {
      return res.status(409).json({ detail: 'Este registro já está ativo e não pode ser restaurado.' });
    }

    if (modulo === 'adquirente') {
      const transaction = await sequelize.transaction();
      try {
        const restoredRates = await getTaxaCartaoModel().findAll({ where: { adquirente_id: id }, transaction });
        const { getHistoricoTaxasCartaoModel } = await import('../models/HistoricoTaxasCartao.js');
        const { getTenantSchema } = await import('../config/tenantContext.js');
        
        for (const rate of restoredRates) {
          const previousState = JSON.parse(JSON.stringify(rate));
          const updatedRate = { ...previousState, deletado: 'N', deletado_por: null, deletado_em: null, ativo: true };
          
          await getHistoricoTaxasCartaoModel().create({
            taxa_cartao_id: rate.forma_pagamento,
            operacao: 'RESTORE',
            schema: getTenantSchema(),
            alterado_por_id: req.user ? req.user.id : null,
            alterado_por_nome: req.user ? req.user.name : null,
            valores_anteriores: previousState,
            valores_novos: updatedRate,
            ip_origem: req.ip || null
          }, { transaction });
        }

        await record.update({
          deletado: 'N',
          deletado_por: null,
          deletado_em: null,
          ativo: true
        }, { transaction });

        await getTaxaCartaoModel().update({
          deletado: 'N',
          deletado_por: null,
          deletado_em: null,
          ativo: true
        }, { where: { adquirente_id: id }, transaction });

        await transaction.commit();
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } else {
      await record.update({
        deletado: 'N',
        deletado_por: null,
        deletado_em: null
      });
    }

    res.json({ ok: true, detail: 'Registro restaurado com sucesso.' });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export { getDeletados, restoreRecord };

