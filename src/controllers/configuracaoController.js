import { getTaxaCartaoModel } from '../models/TaxaCartao.js';
import { getEmpresaModel } from '../models/Empresa.js';
import { getConfiguracaoSistemaModel } from '../models/ConfiguracaoSistema.js';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';

const logTaxaHistorico = async (taxaId, operacao, valoresAnteriores, valoresNovos, req) => {
  try {
    const { getHistoricoTaxasCartaoModel } = await import('../models/HistoricoTaxasCartao.js');
    const { getTenantSchema } = await import('../config/tenantContext.js');
    await getHistoricoTaxasCartaoModel().create({
      taxa_cartao_id: taxaId,
      operacao,
      schema: getTenantSchema(),
      alterado_por_id: req.user ? req.user.id : null,
      alterado_por_nome: req.user ? req.user.name : null,
      valores_anteriores: valoresAnteriores ? JSON.parse(JSON.stringify(valoresAnteriores)) : null,
      valores_novos: valoresNovos ? JSON.parse(JSON.stringify(valoresNovos)) : null,
      ip_origem: req.ip || null,
      motivo_alteracao: req.body.motivo_alteracao || null
    });
  } catch (error) {
    console.error('Falha ao registrar historico de taxas:', error);
  }
};


const getTaxas = async (req, res) => {
  try {
    let taxas = await getTaxaCartaoModel().findAll({
      where: { deletado: 'N' },
      order: [['descricao', 'ASC'], ['forma_pagamento', 'ASC']]
    });

    if (taxas.length === 0) {
      await getTaxaCartaoModel().bulkCreate([
        { forma_pagamento: 'cartao_credito', percentual: 2.5, ativo: true, tipo_cartao: 'credito', descricao: 'Cartão Crédito', taxa_1x: 2.5 },
        { forma_pagamento: 'cartao_debito', percentual: 1.5, ativo: true, tipo_cartao: 'debito', descricao: 'Cartão Débito' }
      ]);
      taxas = await getTaxaCartaoModel().findAll({
        where: { deletado: 'N' },
        order: [['descricao', 'ASC'], ['forma_pagamento', 'ASC']]
      });
    }
    res.json(taxas);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const saveTaxa = async (req, res) => {
  try {
    const {
      percentual,
      ativo,
      dias_recebimento,
      adquirente_id,
      descricao,
      tipo_cartao,
      bandeira,
      taxa_1x,
      taxa_2x,
      taxa_3x,
      taxa_4x,
      taxa_5x,
      taxa_6x,
      taxa_7x,
      taxa_8x,
      taxa_9x,
      taxa_10x,
      taxa_11x,
      taxa_12x
    } = req.body;

    let { forma_pagamento } = req.body;

    if (!tipo_cartao || !['credito', 'debito'].includes(tipo_cartao)) {
      return res.status(400).json({ detail: 'O tipo do cartão (credito ou debito) é obrigatório.' });
    }

    if (dias_recebimento !== undefined && parseInt(dias_recebimento) < 0) {
      return res.status(400).json({ detail: 'O prazo de recebimento (dias) não pode ser negativo.' });
    }

    // Validar percentual geral
    const pVal = parseFloat(percentual) || 0;
    if (pVal < 0 || pVal > 100) {
      return res.status(400).json({ detail: 'A taxa percentual deve estar entre 0% e 100%.' });
    }

    // Validar taxas específicas por parcela no crédito
    if (tipo_cartao === 'credito') {
      if (taxa_1x === undefined || taxa_1x === null || isNaN(parseFloat(taxa_1x))) {
        return res.status(400).json({ detail: 'A taxa de parcelamento de 1x é obrigatória para cartão de crédito.' });
      }

      const parcelasTaxas = [
        taxa_1x, taxa_2x, taxa_3x, taxa_4x, taxa_5x, taxa_6x,
        taxa_7x, taxa_8x, taxa_9x, taxa_10x, taxa_11x, taxa_12x
      ];

      for (let i = 0; i < parcelasTaxas.length; i++) {
        const val = parseFloat(parcelasTaxas[i]);
        if (parcelasTaxas[i] !== undefined && parcelasTaxas[i] !== null) {
          if (isNaN(val) || val < 0 || val > 100) {
            return res.status(400).json({ detail: `A taxa da parcela ${i + 1}x deve ser um número entre 0% e 100%.` });
          }
        }
      }
    }

    // Se for novo registro
    if (!forma_pagamento) {
      const prefix = tipo_cartao === 'credito' ? 'credito' : 'debito';
      forma_pagamento = `${prefix}_${uuidv4().split('-')[0]}`;
    }

    // Validar duplicidade de descrição considerando a bandeira
    if (descricao && descricao.trim()) {
      const whereDesc = {
        deletado: 'N',
        ativo: true,
        forma_pagamento: { [Op.ne]: forma_pagamento },
        descricao: sequelize.where(
          sequelize.fn('lower', sequelize.col('descricao')),
          descricao.trim().toLowerCase()
        )
      };

      if (bandeira) {
        whereDesc.bandeira = bandeira;
      } else {
        whereDesc.bandeira = { [Op.or]: [null, ''] };
      }

      const existingDesc = await getTaxaCartaoModel().findOne({ where: whereDesc });
      if (existingDesc) {
        return res.status(400).json({ detail: 'Já existe uma forma de pagamento de cartão ativa com esta descrição para esta bandeira/padrão.' });
      }
    }

    const [taxa, created] = await getTaxaCartaoModel().findOrCreate({
      where: { forma_pagamento },
      defaults: {
        percentual: pVal,
        ativo: ativo !== undefined ? ativo : true,
        dias_recebimento: dias_recebimento !== undefined ? parseInt(dias_recebimento) : 0,
        adquirente_id: adquirente_id || null,
        descricao: descricao ? descricao.trim() : null,
        tipo_cartao,
        bandeira: bandeira || null,
        taxa_1x: taxa_1x !== undefined ? parseFloat(taxa_1x) : pVal,
        taxa_2x: taxa_2x !== undefined ? parseFloat(taxa_2x) : 0,
        taxa_3x: taxa_3x !== undefined ? parseFloat(taxa_3x) : 0,
        taxa_4x: taxa_4x !== undefined ? parseFloat(taxa_4x) : 0,
        taxa_5x: taxa_5x !== undefined ? parseFloat(taxa_5x) : 0,
        taxa_6x: taxa_6x !== undefined ? parseFloat(taxa_6x) : 0,
        taxa_7x: taxa_7x !== undefined ? parseFloat(taxa_7x) : 0,
        taxa_8x: taxa_8x !== undefined ? parseFloat(taxa_8x) : 0,
        taxa_9x: taxa_9x !== undefined ? parseFloat(taxa_9x) : 0,
        taxa_10x: taxa_10x !== undefined ? parseFloat(taxa_10x) : 0,
        taxa_11x: taxa_11x !== undefined ? parseFloat(taxa_11x) : 0,
        taxa_12x: taxa_12x !== undefined ? parseFloat(taxa_12x) : 0,
        criado_por_id: req.user ? req.user.id : null,
        criado_por_nome: req.user ? req.user.name : null,
        alterado_por_id: req.user ? req.user.id : null,
        alterado_por_nome: req.user ? req.user.name : null
      }
    });

    if (created) {
      await logTaxaHistorico(forma_pagamento, 'CREATE', null, taxa, req);
    } else {
      const previousState = JSON.parse(JSON.stringify(taxa));

      if (percentual !== undefined) taxa.percentual = pVal;
      if (ativo !== undefined) taxa.ativo = ativo;
      if (dias_recebimento !== undefined) taxa.dias_recebimento = parseInt(dias_recebimento) || 0;
      if (adquirente_id !== undefined) taxa.adquirente_id = adquirente_id || null;
      if (descricao !== undefined) taxa.descricao = descricao ? descricao.trim() : null;
      if (tipo_cartao !== undefined) taxa.tipo_cartao = tipo_cartao;
      if (bandeira !== undefined) taxa.bandeira = bandeira || null;

      // Atualizar taxas parcelas se créditos
      if (tipo_cartao === 'credito') {
        if (taxa_1x !== undefined) taxa.taxa_1x = parseFloat(taxa_1x);
        if (taxa_2x !== undefined) taxa.taxa_2x = parseFloat(taxa_2x);
        if (taxa_3x !== undefined) taxa.taxa_3x = parseFloat(taxa_3x);
        if (taxa_4x !== undefined) taxa.taxa_4x = parseFloat(taxa_4x);
        if (taxa_5x !== undefined) taxa.taxa_5x = parseFloat(taxa_5x);
        if (taxa_6x !== undefined) taxa.taxa_6x = parseFloat(taxa_6x);
        if (taxa_7x !== undefined) taxa.taxa_7x = parseFloat(taxa_7x);
        if (taxa_8x !== undefined) taxa.taxa_8x = parseFloat(taxa_8x);
        if (taxa_9x !== undefined) taxa.taxa_9x = parseFloat(taxa_9x);
        if (taxa_10x !== undefined) taxa.taxa_10x = parseFloat(taxa_10x);
        if (taxa_11x !== undefined) taxa.taxa_11x = parseFloat(taxa_11x);
        if (taxa_12x !== undefined) taxa.taxa_12x = parseFloat(taxa_12x);
      } else {
        // Para débito, limpar taxas de parcelamento para integridade
        for (let i = 1; i <= 12; i++) {
          taxa[`taxa_${i}x`] = 0;
        }
      }

      if (req.user) {
        taxa.alterado_por_id = req.user.id;
        taxa.alterado_por_nome = req.user.name;
      }

      await taxa.save();
      await logTaxaHistorico(forma_pagamento, 'UPDATE', previousState, taxa, req);
    }

    res.json(taxa);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteTaxa = async (req, res) => {
  try {
    const { forma_pagamento } = req.params;
    const taxa = await getTaxaCartaoModel().findByPk(forma_pagamento);
    if (!taxa || taxa.deletado === 'S') {
      return res.status(404).json({ detail: 'Forma de pagamento não encontrada.' });
    }

    const previousState = JSON.parse(JSON.stringify(taxa));

    const deletedBy = req.user ? req.user.name : 'Sistema';
    await taxa.update({
      deletado: 'S',
      deletado_por: deletedBy,
      deletado_em: new Date(),
      ativo: false
    });

    await logTaxaHistorico(forma_pagamento, 'DELETE', previousState, taxa, req);

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};


const getEmpresa = async (req, res) => {
  try {
    let empresa = await getEmpresaModel().findOne();
    if (!empresa) {
      empresa = await getEmpresaModel().create({
        razao_social: '',
        nome_fantasia: '',
        cnpj: '',
        inscricao_estadual: '',
        email: '',
        telefone: '',
        endereco_cep: '',
        endereco_logradouro: '',
        endereco_numero: '',
        endereco_bairro: '',
        endereco_cidade: '',
        endereco_uf: ''
      });
    }
    res.json(empresa);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const saveEmpresa = async (req, res) => {
  try {
    let empresa = await getEmpresaModel().findOne();
    if (!empresa) {
      empresa = await getEmpresaModel().create(req.body);
    } else {
      await empresa.update(req.body);
    }
    res.json(empresa);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const getPublicEmpresa = async (req, res) => {
  try {
    const empresa = await getEmpresaModel().findOne();
    if (empresa) {
      res.json({
        nome_fantasia: empresa.nome_fantasia || "",
        logomarca: empresa.logomarca || null,
        logomarca_dark: empresa.logomarca_dark || null
      });
    } else {
      res.json({ nome_fantasia: "", logomarca: null, logomarca_dark: null });
    }
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const getConfiguracaoSistema = async (req, res) => {
  try {
    let config = await getConfiguracaoSistemaModel().findOne();
    if (!config) {
      config = await getConfiguracaoSistemaModel().create({
        bloquear_valor_agendamento_menor: false,
        permitir_estoque_negativo: false,
        permitir_cliente_duplicado: false,
        agendamento_online_ativo: true
      });
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const saveConfiguracaoSistema = async (req, res) => {
  try {
    let config = await getConfiguracaoSistemaModel().findOne();
    if (!config) {
      config = await getConfiguracaoSistemaModel().create(req.body);
    } else {
      await config.update(req.body);
    }
    res.json(config);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export { getTaxas, saveTaxa, deleteTaxa, getEmpresa, saveEmpresa, getPublicEmpresa, getConfiguracaoSistema, saveConfiguracaoSistema };

