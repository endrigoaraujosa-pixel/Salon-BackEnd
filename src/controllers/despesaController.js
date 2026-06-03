import { db } from "../config/db.js";
const getTodayDateString = () => {
  // Return YYYY-MM-DD in local time
  return new Date().toLocaleDateString('en-CA');
};

const listDespesas = async (req, res) => {
  try {
    const despesas = await db.Despesa.findAll({
      where: { deletado: 'N' },
      order: [['data_vencimento', 'DESC']]
    });
    
    const today = getTodayDateString();
    
    // Dynamically calculate "Vencido" status for overdue, unpaid, non-cancelled expenses
    const updatedDespesas = despesas.map(d => {
      const plain = d.get({ plain: true });
      if (plain.status === 'Aberto' && !plain.pago && plain.data_vencimento && plain.data_vencimento < today) {
        plain.status = 'Vencido';
      }
      return plain;
    });
    
    res.json(updatedDespesas);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createDespesa = async (req, res) => {
  try {
    if (req.body.valor !== undefined) {
      const valorStr = String(req.body.valor).replace(",", ".");
      req.body.valor = parseFloat(valorStr) || 0;
    }
    if (!req.body.descricao || !String(req.body.descricao).trim()) {
      return res.status(400).json({ detail: 'Descrição é obrigatória' });
    }
    
    // Set default status based on payment field
    if (req.body.pago === true || req.body.status === 'Pago') {
      req.body.pago = true;
      req.body.status = 'Pago';
      req.body.baixado_por = req.user ? req.user.name : 'Sistema';
      req.body.baixado_em = new Date();
      if (!req.body.data_pagamento) {
        req.body.data_pagamento = getTodayDateString();
      }
    } else {
      if (!req.body.status) {
        req.body.status = 'Aberto';
      }
      req.body.pago = false;
    }

    const despesa = await db.Despesa.create(req.body);
    res.status(201).json(despesa);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateDespesa = async (req, res) => {
  try {
    const despesa = await db.Despesa.findByPk(req.params.id);
    if (!despesa) return res.status(404).json({ detail: 'Despesa não encontrada' });
    
    // Security restriction: Restrict editing of already paid expenses
    // Allow updating if they are explicitly undoing the payment (setting pago to false or status to Aberto)
    const wasPaid = despesa.pago || despesa.status === 'Pago';
    const isUndoingPayment = req.body.pago === false || req.body.status === 'Aberto';
    
    if (wasPaid && !isUndoingPayment) {
      // If there are other modifications besides toggling payment details, block them
      // Let's check if the fields are actually changing from original values
      const coreFields = ['descricao', 'valor', 'tipo', 'categoria', 'data_documento', 'data_vencimento', 'numero_documento', 'fornecedor', 'observacoes'];
      const hasCoreChanges = coreFields.some(field => {
        if (req.body[field] !== undefined) {
          // Compare strings/numbers carefully
          const original = despesa[field] === null ? '' : String(despesa[field]);
          const incoming = req.body[field] === null ? '' : String(req.body[field]);
          return original !== incoming;
        }
        return false;
      });
      
      if (hasCoreChanges) {
        return res.status(400).json({ detail: 'Não é possível editar os dados de uma despesa já paga. Desmarque como paga primeiro.' });
      }
    }
    
    if (req.body.valor !== undefined) {
      const valorStr = String(req.body.valor).replace(",", ".");
      req.body.valor = parseFloat(valorStr) || 0;
    }
    if (req.body.descricao !== undefined && (!req.body.descricao || !String(req.body.descricao).trim())) {
      return res.status(400).json({ detail: 'Descrição é obrigatória' });
    }

    // Payment write-off logging logic
    if (req.body.pago === true || req.body.status === 'Pago') {
      if (!wasPaid) {
        req.body.pago = true;
        req.body.status = 'Pago';
        req.body.baixado_por = req.user ? req.user.name : 'Sistema';
        req.body.baixado_em = new Date();
        if (!req.body.data_pagamento) {
          req.body.data_pagamento = getTodayDateString();
        }
      }
    } else if (req.body.pago === false || req.body.status === 'Aberto') {
      if (wasPaid) {
        req.body.pago = false;
        req.body.status = 'Aberto';
        req.body.baixado_por = null;
        req.body.baixado_em = null;
        req.body.data_pagamento = '';
      }
    }
    
    await despesa.update(req.body);
    res.json(despesa);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteDespesa = async (req, res) => {
  try {
    const despesa = await db.Despesa.findByPk(req.params.id);
    if (!despesa) return res.status(404).json({ detail: 'Despesa não encontrada' });
    
    // Restrict deletion of paid expenses
    if (despesa.pago || despesa.status === 'Pago') {
      return res.status(400).json({ detail: 'Não é possível excluir uma despesa que já foi paga. Desmarque como paga primeiro.' });
    }
    
    await despesa.update({
      deletado: 'S',
      deletado_por: req.user ? req.user.name : 'Sistema',
      deletado_em: new Date()
    });
    
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export {
  createDespesa, deleteDespesa, listDespesas, updateDespesa
};

