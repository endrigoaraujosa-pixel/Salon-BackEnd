import TaxaCartao from '../models/TaxaCartao.js';

const getTaxas = async (req, res) => {
  try {
    let taxas = await TaxaCartao.findAll();
    if (taxas.length === 0) {
      await TaxaCartao.bulkCreate([
        { forma_pagamento: 'cartao_credito', percentual: 2.5, ativo: true },
        { forma_pagamento: 'cartao_debito', percentual: 1.5, ativo: true }
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
    const { forma_pagamento, percentual, ativo } = req.body;
    if (!forma_pagamento) {
      return res.status(400).json({ detail: 'Forma de pagamento é obrigatória' });
    }

    const [taxa, created] = await TaxaCartao.findOrCreate({
      where: { forma_pagamento },
      defaults: { percentual: percentual || 0, ativo: ativo !== undefined ? ativo : true }
    });

    if (!created) {
      if (percentual !== undefined) taxa.percentual = percentual;
      if (ativo !== undefined) taxa.ativo = ativo;
      await taxa.save();
    }

    res.json(taxa);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export { getTaxas, saveTaxa };
