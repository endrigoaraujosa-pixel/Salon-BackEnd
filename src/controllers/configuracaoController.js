import { getTaxaCartaoModel } from '../models/TaxaCartao.js';
import { getEmpresaModel } from '../models/Empresa.js';
import { getConfiguracaoSistemaModel } from '../models/ConfiguracaoSistema.js';

const getTaxas = async (req, res) => {
  try {
    let taxas = await getTaxaCartaoModel().findAll();
    if (taxas.length === 0) {
      await getTaxaCartaoModel().bulkCreate([
        { forma_pagamento: 'cartao_credito', percentual: 2.5, ativo: true },
        { forma_pagamento: 'cartao_debito', percentual: 1.5, ativo: true }
      ]);
      taxas = await getTaxaCartaoModel().findAll();
    }
    res.json(taxas);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const saveTaxa = async (req, res) => {
  try {
    const { forma_pagamento, percentual, ativo, dias_recebimento } = req.body;
    if (!forma_pagamento) {
      return res.status(400).json({ detail: 'Forma de pagamento é obrigatória' });
    }

    const [taxa, created] = await getTaxaCartaoModel().findOrCreate({
      where: { forma_pagamento },
      defaults: { 
        percentual: percentual || 0, 
        ativo: ativo !== undefined ? ativo : true,
        dias_recebimento: dias_recebimento !== undefined ? parseInt(dias_recebimento) : 0
      }
    });

    if (!created) {
      if (percentual !== undefined) taxa.percentual = percentual;
      if (ativo !== undefined) taxa.ativo = ativo;
      if (dias_recebimento !== undefined) taxa.dias_recebimento = parseInt(dias_recebimento) || 0;
      await taxa.save();
    }

    res.json(taxa);
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
        nome_fantasia: empresa.nome_fantasia || ""
      });
    } else {
      res.json({ nome_fantasia: "" });
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
        permitir_estoque_negativo: false
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

export { getTaxas, saveTaxa, getEmpresa, saveEmpresa, getPublicEmpresa, getConfiguracaoSistema, saveConfiguracaoSistema };

