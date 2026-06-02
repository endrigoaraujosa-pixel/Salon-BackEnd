import TaxaCartao from '../models/TaxaCartao.js';
import Empresa from '../models/Empresa.js';

const getTaxas = async (req, res) => {
  try {
    let taxas = await TaxaCartao.findAll();
    if (taxas.length === 0) {
      await TaxaCartao.bulkCreate([
        { forma_pagamento: 'cartao_credito', percentual: 2.5, ativo: true, dias_recebimento: 30 },
        { forma_pagamento: 'cartao_debito', percentual: 1.5, ativo: true, dias_recebimento: 1 }
      ]);
      taxas = await TaxaCartao.findAll();
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

    const [taxa, created] = await TaxaCartao.findOrCreate({
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
    let empresa = await Empresa.findOne();
    if (!empresa) {
      empresa = await Empresa.create({
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
    let empresa = await Empresa.findOne();
    if (!empresa) {
      empresa = await Empresa.create(req.body);
    } else {
      await empresa.update(req.body);
    }
    res.json(empresa);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export { getTaxas, saveTaxa, getEmpresa, saveEmpresa };
